/* eslint-disable react/prop-types */
import { useEffect, useId, useRef, useState } from "react";
import {
  Link, useFetcher, useLoaderData, useNavigate, useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  compareReviews, createCorrection, finalizeReview, getReview,
  getUsage, listReviews, ReviewError, updateReviewRow,
} from "../models/review.server.js";
import { getCatalogSnapshot } from "../services/catalog.server.js";
import { getEntitlement } from "../services/entitlements.server.js";
import { isCatalogError, readReviewForm, reviewActionError, reviewActor } from "../services/review-routes.server.js";
import { costLabel, DownloadButton, downloadReview, ErrorNotice, formatDate, issueLabel, ReviewStatus } from "../components/review-ui";
import { WorkspaceIcon } from "../components/workspace-ui.jsx";

const PAGE_SIZE = 40;
const decisionFilters = [
  ["all", "All rows"], ["ready", "Ready to review"], ["matching", "Needs matching"],
  ["approved", "Approved"], ["excluded", "Excluded"],
];
const reviewStats = [
  ["ready", "Ready to review", "clock"], ["matching", "Needs matching", "alert"],
  ["approved", "Approved", "check"], ["excluded", "Excluded", "minus"],
];

function displayRow(row) {
  const {
    id, sku, oldCost, newCost, change, changeKind, percentChange, oldLine, newLine,
    decision, issue, stale, variantId, variantSku, variantTitle, productTitle,
    imageUrl, imageAlt, note, decidedAt, candidates,
  } = row;
  return {
    id, sku, oldCost, newCost, change, changeKind, percentChange, oldLine, newLine,
    decision, issue, stale, variantId, variantSku, variantTitle, productTitle,
    imageUrl, imageAlt, note, decidedAt,
    candidates: candidates?.map(({ id, sku, title, productTitle }) => ({ id, sku, title, productTitle })),
  };
}

function displayComparison(comparison) {
  if (!comparison) return undefined;
  const cell = (row) => {
    if (!row) return null;
    const { sku, oldCost, newCost, variantSku, decision, issue, note } = row;
    return { sku, oldCost, newCost, variantSku, decision, issue, note };
  };
  return {
    other: { currency: comparison.other.currency },
    rows: comparison.rows.map(({ key, sku, before, after, changed }) => ({
      key, sku, changed, before: cell(before), after: cell(after),
    })),
  };
}

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const searchParams = new URL(request.url).searchParams;
  let review;
  try {
    review = await getReview(shop, params.batchId);
    if (!review) throw new ReviewError("NOT_FOUND", "This review could not be found.", 404);
  } catch (error) {
    return reviewActionError(error);
  }

  const entitlement = await getEntitlement({ admin, session });
  const locked = review.status === "FINALIZED";
  const usage = await getUsage(shop, entitlement);
  let catalogNotice;
  if ((locked || searchParams.get("check") === "1") && review.rows.some((row) => row.variantId && row.decision !== "EXCLUDED")) {
    try {
      review = await getReview(shop, review.id, await getCatalogSnapshot(admin, session));
    } catch (error) {
      if (!isCatalogError(error)) throw error;
      catalogNotice = error.message;
    }
  }

  const compareId = searchParams.get("compare");
  let comparison;
  let comparisonError;
  let comparisonOptions = [];
  if (locked && entitlement.canCompare) {
    const all = await listReviews(shop, entitlement, review.supplierId);
    comparisonOptions = all.filter((other) => other.id !== review.id && other.status === "FINALIZED");
    if (compareId) {
      try {
        comparison = await compareReviews(shop, entitlement, review.id, compareId);
      } catch (error) {
        if (!(error instanceof ReviewError)) throw error;
        comparisonError = error.message;
      }
    }
  } else if (compareId) {
    comparisonError = "Finalized version comparison is available on Growth and Pro.";
  }

  const {
    id, version, revision, parentId, oldFilename, newFilename, currency, rowCount, status,
    finalizedAt, stale, supplierCode, supplierName, rows,
  } = review;
  return {
    review: {
      id, version, revision, parentId, oldFilename, newFilename, currency, rowCount, status,
      finalizedAt, stale, supplierCode, supplierName, rows: rows.map(displayRow),
    },
    entitlement, usage, catalogNotice, compareId, comparison: displayComparison(comparison),
    comparisonOptions: comparisonOptions.map(({ id, revision, newFilename, finalizedAt }) => ({ id, revision, newFilename, finalizedAt })),
    comparisonError,
    duplicate: searchParams.get("notice") === "duplicate",
  };
}

export async function action({ request, params }) {
  const context = await authenticate.admin(request);
  const { admin, session } = context;
  const shop = session.shop;
  const reviewId = params.batchId;
  try {
    const form = await readReviewForm(request);
    const entitlement = await getEntitlement({ admin, session });
    if (!entitlement.id) {
      throw new ReviewError("PLAN_REQUIRED", "Choose a plan to update or finalize reviews.", 403);
    }
    const actor = reviewActor(context);
    const base = {
      shop, entitlement, reviewId, version: Number(form.get("version")), actor, sessionId: session.id,
    };
    const intent = form.get("intent");

    if (intent === "lookup") {
      const query = String(form.get("query") ?? "").trim().toLowerCase();
      if (!query || query.length > 120) {
        throw new ReviewError("CATALOG_QUERY", "Enter a SKU or variant name of up to 120 characters.", 400);
      }
      const variants = await getCatalogSnapshot(admin, session);
      const searchable = variants.filter((variant) => variant.sku);
      const exact = searchable.filter((variant) => variant.sku.toLowerCase() === query);
      const matches = searchable.filter((variant) => variant.sku.toLowerCase() !== query &&
        [variant.sku, variant.title, variant.productTitle].some((field) => field?.toLowerCase().includes(query)));
      return { matches: [...exact, ...matches].slice(0, 20), lookup: true };
    }
    if (!Number.isInteger(base.version) || base.version < 0) {
      throw new ReviewError("INVALID_VERSION", "Refresh this review to recover the current version.", 400);
    }

    if (intent === "decide" || intent === "map") {
      const rowId = String(form.get("rowId") ?? "");
      const note = String(form.get("note") ?? "");
      const choice = String(form.get("decision") ?? "");
      const variantId = intent === "map" ? String(form.get("variantId") ?? "") : null;
      let variant;
      if (intent === "map") {
        if (!variantId) throw new ReviewError("VARIANT_REQUIRED", "Choose a Shopify variant to confirm the match.", 400);
        variant = (await getCatalogSnapshot(admin, session)).find((item) => item.id === variantId);
        if (!variant) throw new ReviewError("VARIANT_MISSING", "This variant could not be found in Shopify. Look up the SKU again.", 409);
      } else if (!["APPROVED", "EXCLUDED", "PENDING"].includes(choice)) {
        throw new ReviewError("INVALID_DECISION", "Choose a decision for this quote line.", 400);
      }
      await updateReviewRow({
        ...base, rowId, note, variant, variantId, decision: intent === "map" ? "PENDING" : choice,
      });
      return { saved: true };
    }
    if (intent === "finalize") {
      const current = await getReview(shop, reviewId);
      const variants = current?.status === "FINALIZED" ? undefined : await getCatalogSnapshot(admin, session);
      await finalizeReview({ ...base, variants });
      return { finalized: reviewId };
    }
    if (intent === "correction") {
      const variants = await getCatalogSnapshot(admin, session);
      const correction = await createCorrection({ ...base, variants });
      return { correctionId: correction.id };
    }
    throw new ReviewError("REVIEW_ACTION", "Choose an action for this review.", 400);
  } catch (error) {
    return reviewActionError(error);
  }
}

export function shouldRevalidate({ formData, defaultShouldRevalidate }) {
  return formData?.get("intent") === "lookup" ? false : defaultShouldRevalidate;
}

function Dialog({ title, children, close, busy = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref} className="cf-dialog cf-flow" aria-labelledby={titleId}
      onClose={close}
      onCancel={(event) => { if (busy) event.preventDefault(); }}
    >
      <div className="cf-split cf-dialog-head">
        <div className="cf-stack-sm">
          <p className="cf-kicker">Cost Review</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button className="cf-button cf-button-sm" type="button" onClick={() => ref.current.close()} disabled={busy}>
          <WorkspaceIcon name="close" /> Close
        </button>
      </div>
      <div className="cf-stack cf-dialog-body">{children}</div>
    </dialog>
  );
}

function Product({ row }) {
  return (
    <div className="cf-product">
      {row.imageUrl ? <img src={row.imageUrl} alt={row.imageAlt || ""} loading="lazy" /> : (
        <span className="cf-product-placeholder" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25">
            <path d="m3 6 7-3 7 3v8l-7 3-7-3V6Z" /><path d="m3 6 7 3 7-3m-7 3v8" />
          </svg>
        </span>
      )}
      <div className="cf-stack-sm">
        <strong className="cf-break">{row.productTitle || row.sku || "Missing SKU"}</strong>
        {row.variantTitle && row.variantTitle !== "Default Title" && <span className="cf-break">{row.variantTitle}</span>}
        {row.productTitle && <span className="cf-note cf-break">{row.sku || "Missing source SKU"}</span>}
      </div>
    </div>
  );
}

function DecisionStatus({ row }) {
  let label = "Ready to review";
  let tone = "cf-info";
  if (row.decision === "EXCLUDED") {
    label = "Excluded";
    tone = "";
  } else if (row.stale) {
    label = "Source changed";
    tone = "cf-wait";
  } else if (row.decision === "APPROVED") {
    label = "Approved";
    tone = "cf-good";
  } else if (row.issue) {
    label = issueLabel(row.issue) || "Needs matching";
    tone = "cf-wait";
  }
  return <span className={`cf-badge cf-decision-badge ${tone}`}><span className="cf-decision-dot" aria-hidden="true" />{label}</span>;
}

function rowGroup(row) {
  if (row.decision === "EXCLUDED") return "excluded";
  if (row.stale || (row.decision === "PENDING" && row.issue)) return "matching";
  return row.decision === "APPROVED" ? "approved" : "ready";
}

function Change({ row, currency }) {
  if (row.change == null) return <span className="cf-muted">—</span>;
  const increase = ["INCREASE", "NEW_COST"].includes(row.changeKind);
  const prefix = increase ? "+" : "";
  const percentage = row.changeKind === "NEW_COST" ? "New cost" : row.percentChange == null ? "" : row.percentChange + "%";
  return (
    <span className={"cf-cost-block " + (increase ? "cf-up" : row.changeKind === "DECREASE" ? "cf-down" : "cf-muted")}>
      <span className="cf-numeric">{costLabel(prefix + row.change, currency)}</span>
      {percentage && <small>{percentage}</small>}
    </span>
  );
}

function PageControls({ page, lastPage, total, setPage }) {
  if (lastPage <= 1) return null;
  return (
    <div className="cf-split cf-pagination">
      <p className="cf-note">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} rows</p>
      <div className="cf-row">
        <button className="cf-button cf-button-sm" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="cf-button cf-button-sm" type="button" disabled={page === lastPage} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function Rows({ review, locked, canEdit, openRow, counts, canCompare }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = query.trim().toLowerCase();
  const visible = review.rows.filter((row) => {
    if (search && ![row.sku, row.variantSku, row.variantTitle, row.productTitle].some((value) => value?.toLowerCase().includes(search))) return false;
    return filter === "all" || rowGroup(row) === filter;
  });
  const lastPage = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, lastPage);
  const rows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const label = locked || !canEdit ? "View details" : "Review line";
  const rowButton = (row) => (
    <button className="cf-button cf-button-sm cf-line-action" type="button" onClick={() => openRow(row.id)} aria-label={label + " for " + (row.sku || "missing SKU")}>
      <WorkspaceIcon name="chevron" /> {label}
    </button>
  );

  return (
    <section className="cf-card cf-stack cf-review-panel" aria-labelledby="quote-lines-heading">
      <div className="cf-split cf-review-panel-head">
        <div className="cf-stack-sm">
          <h2 id="quote-lines-heading">Quote lines</h2>
          <p className="cf-muted">Open a line to check its source, match, and decision.</p>
        </div>
        {canCompare && <a className="cf-button" href="#compare-versions"><WorkspaceIcon name="compare" /> Compare versions</a>}
      </div>
      <div className="cf-split cf-filter-bar">
        <div className="cf-segmented" role="group" aria-label="Decision status">
          {decisionFilters.map(([value, name]) => (
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>
              {name} <span aria-hidden="true">{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="cf-row-search">
          <WorkspaceIcon name="search" />
          <input type="search" aria-label="Search rows" value={query} placeholder="Search SKU or variant" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </label>
      </div>
      {rows.length ? (
        <>
          <div className="cf-table-wrap cf-review-table">
            <table className="cf-table">
              <thead><tr>
                <th scope="col">Variant</th><th scope="col">Old cost</th><th scope="col">Proposed cost</th>
                <th scope="col">Change</th><th scope="col">Decision</th><th scope="col" aria-label="Line actions" />
              </tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.id}>
                  <td><Product row={row} /></td>
                  <td className="cf-numeric">{costLabel(row.oldCost, review.currency)}</td>
                  <td className="cf-numeric">{costLabel(row.newCost, review.currency)}</td>
                  <td><Change row={row} currency={review.currency} /></td>
                  <td><DecisionStatus row={row} /></td>
                  <td className="cf-line-actions">{rowButton(row)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div>{rows.map((row) => (
            <article className="cf-mobile-row" key={row.id}>
              <Product row={row} />
              <dl className="cf-mobile-costs">
                <div><dt>Old cost</dt><dd>{costLabel(row.oldCost, review.currency)}</dd></div>
                <div><dt>Proposed cost</dt><dd>{costLabel(row.newCost, review.currency)}</dd></div>
                <div><dt>Change</dt><dd><Change row={row} currency={review.currency} /></dd></div>
              </dl>
              <div className="cf-split"><DecisionStatus row={row} />{rowButton(row)}</div>
            </article>
          ))}</div>
          <PageControls page={currentPage} lastPage={lastPage} total={visible.length} setPage={setPage} />
        </>
      ) : <p className="cf-empty cf-muted">No rows match these filters.</p>}
    </section>
  );
}

function Lookup({ fetcher, disabled }) {
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="cf-stack-sm">
      <input type="hidden" name="intent" value="lookup" />
      <label className="cf-field">
        <span>Find a Shopify variant</span>
        <input name="query" type="search" maxLength={120} required placeholder="SKU or product name" disabled={disabled || busy} />
      </label>
      <div><button type="submit" className="cf-button cf-button-sm" disabled={disabled || busy}>{busy ? "Searching…" : "Search variants"}</button></div>
      <ErrorNotice error={fetcher.data?.error} />
      {fetcher.data?.lookup && !fetcher.data.matches.length && <p className="cf-note" role="status">No Shopify variants with a SKU matched your search.</p>}
    </fetcher.Form>
  );
}

function RowDialog({ review, row, close, canEdit }) {
  const change = useFetcher();
  const lookup = useFetcher();
  const busy = change.state !== "idle";
  const candidateMap = new Map();
  for (const candidate of [...(row.candidates ?? []), ...(lookup.data?.matches ?? [])]) {
    candidateMap.set(candidate.id, candidate);
  }
  const candidates = [...candidateMap.values()];
  const canMap = canEdit && (row.stale || ["UNMATCHED", "AMBIGUOUS", "STALE", "VARIANT_IN_USE"].includes(row.issue));
  const canApprove = !row.issue && !row.stale && Boolean(row.variantId);

  return (
    <Dialog title="Quote line details" close={close} busy={busy}>
      <div className="cf-split cf-detail-overview">
        <Product row={row} />
        <DecisionStatus row={row} />
      </div>
      <h3>Source files</h3>
      <div className="cf-columns-even cf-source-pair">
        <div className="cf-stack-sm">
          <span className="cf-kicker">Old quote</span>
          <strong>{costLabel(row.oldCost, review.currency)}</strong>
          <p className="cf-note cf-break">{review.oldFilename}{row.oldLine ? " · row " + row.oldLine : ""}</p>
        </div>
        <div className="cf-stack-sm">
          <span className="cf-kicker">New quote</span>
          <strong>{costLabel(row.newCost, review.currency)}</strong>
          <p className="cf-note cf-break">{review.newFilename}{row.newLine ? " · row " + row.newLine : ""}</p>
        </div>
      </div>
      <dl className="cf-readout">
        <dt>Change</dt><dd><Change row={row} currency={review.currency} /></dd>
        <dt>Matched SKU</dt><dd>{row.variantSku || "—"}</dd>
        {row.decidedAt && <><dt>Decided on</dt><dd>{formatDate(row.decidedAt)}</dd></>}
        {row.note && <><dt>Reason</dt><dd>{row.note}</dd></>}
      </dl>
      {row.stale && <p className="cf-warning">The Shopify variant or SKU has changed since this decision was recorded.</p>}
      <ErrorNotice error={change.data?.error} />
      {change.data?.saved && <p className="cf-success" role="status">The quote line was updated.</p>}
      {canMap && (
        <div className="cf-stack cf-dialog-actions">
          <h3>Confirm a Shopify match</h3>
          <p className="cf-muted">Choose the variant that belongs to this supplier SKU. Each variant can be mapped once in a review.</p>
          <Lookup fetcher={lookup} disabled={busy} />
          {candidates.length > 0 && (
            <change.Form method="post" className="cf-stack">
              <input type="hidden" name="intent" value="map" />
              <input type="hidden" name="version" value={review.version} />
              <input type="hidden" name="rowId" value={row.id} />
              <label className="cf-field">
                <span>Shopify variant</span>
                <select name="variantId" required defaultValue="" disabled={busy}>
                  <option value="">Select a variant</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {[candidate.sku, candidate.productTitle, candidate.title].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
              <div><button type="submit" className="cf-button" disabled={busy}>Confirm match</button></div>
            </change.Form>
          )}
        </div>
      )}
      {canEdit && (
        <change.Form method="post" className="cf-stack cf-dialog-actions">
          <input type="hidden" name="intent" value="decide" />
          <input type="hidden" name="version" value={review.version} />
          <input type="hidden" name="rowId" value={row.id} />
          <label className="cf-field">
            <span>Reason</span>
            <textarea key={row.note || ""} name="note" defaultValue={row.note ?? ""} rows={3} maxLength={500} disabled={busy} />
            <span className="cf-note">A reason is required when you exclude a line.</span>
          </label>
          <div className="cf-row">
            <button type="submit" name="decision" value="APPROVED" className="cf-button cf-primary" disabled={busy || !canApprove}>Approve</button>
            <button type="submit" name="decision" value="EXCLUDED" className="cf-button" disabled={busy}>Exclude</button>
            {row.decision !== "PENDING" && <button type="submit" name="decision" value="PENDING" className="cf-button" disabled={busy}>Reset decision</button>}
          </div>
        </change.Form>
      )}
    </Dialog>
  );
}

function FinalizeDialog({ review, approved, excluded, close }) {
  const fetcher = useFetcher();
  const attempted = useRef(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const busy = fetcher.state !== "idle" || downloading;
  const [searchParams] = useSearchParams();
  const checkParams = new URLSearchParams(searchParams);
  checkParams.set("check", "1");
  useEffect(() => {
    if (fetcher.state !== "idle" || fetcher.data?.finalized !== review.id || attempted.current) return;
    attempted.current = true;
    setDownloading(true);
    downloadReview(review.id).then(close).catch((error) => {
      setDownloadError(error.message);
      setDownloading(false);
    });
  }, [close, fetcher.data, fetcher.state, review.id]);
  return (
    <Dialog title="Finalize and export" close={close} busy={busy}>
      <p>The final version records {approved} approved and {excluded} excluded {approved + excluded === 1 ? "line" : "lines"}. CostFern locks the decisions and downloads the approved costs.</p>
      <p className="cf-note">You can download the same export again from History. Use a linked correction for later changes.</p>
      <ErrorNotice error={fetcher.data?.error || downloadError} />
      {fetcher.data?.code === "STALE_MAPPING" && (
        <Link to={"?" + checkParams.toString()} onClick={close}>Check current Shopify matches</Link>
      )}
      {fetcher.data?.finalized && downloadError ? <DownloadButton reviewId={review.id} primary /> : (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="finalize" />
          <input type="hidden" name="version" value={review.version} />
          <button type="submit" className="cf-button cf-primary" disabled={busy || Boolean(fetcher.data?.finalized)}>
            {busy ? "Locking and preparing CSV…" : "Lock review and download"}
          </button>
        </fetcher.Form>
      )}
    </Dialog>
  );
}

function CompareCell({ row, currency }) {
  if (!row) return <span className="cf-muted">—</span>;
  return (
    <div className="cf-stack-sm">
      <div className="cf-row"><strong>{costLabel(row.newCost, currency)}</strong><DecisionStatus row={row} /></div>
      <span className="cf-note">Old cost {costLabel(row.oldCost, currency)}</span>
      {row.variantSku && row.variantSku !== row.sku && <span className="cf-note">Matched SKU {row.variantSku}</span>}
      {row.note && <span className="cf-note cf-break">{row.note}</span>}
    </div>
  );
}

function VersionComparison({ review, comparison, comparisonOptions, compareId, comparisonError }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [changedOnly, setChangedOnly] = useState(true);
  const rows = comparison?.rows?.filter((row) => !changedOnly || row.changed) ?? [];
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, lastPage);
  function selectVersion(event) {
    const next = new URLSearchParams(searchParams);
    if (event.target.value) next.set("compare", event.target.value);
    else next.delete("compare");
    setPage(1);
    setSearchParams(next, { preventScrollReset: true });
  }
  return (
    <section id="compare-versions" className="cf-card cf-stack" aria-labelledby="compare-versions-heading">
      <div className="cf-stack-sm">
        <h2 id="compare-versions-heading">Compare finalized versions</h2>
        <p className="cf-muted">Compare the proposed cost and decision for each SKU with another finalized review from this supplier.</p>
      </div>
      <ErrorNotice error={comparisonError} />
      {comparisonOptions.length ? (
        <label className="cf-field cf-search">
          <span>Compare with</span>
          <select value={compareId || ""} onChange={selectVersion}>
            <option value="">Select a finalized review</option>
            {comparisonOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {"v" + option.revision + " · " + option.newFilename + " · " + formatDate(option.finalizedAt)}
              </option>
            ))}
          </select>
        </label>
      ) : <p className="cf-note">Finalize another review for this supplier to compare versions.</p>}
      {comparison && (
        <>
          <label className="cf-row">
            <input type="checkbox" checked={changedOnly} onChange={(event) => { setChangedOnly(event.target.checked); setPage(1); }} />
            Changes only
          </label>
          {rows.length ? (
            <div className="cf-table-wrap">
              <table className="cf-table cf-compare">
                <thead><tr><th scope="col">SKU</th><th scope="col">Compared review</th><th scope="col">This review</th></tr></thead>
                <tbody>{rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((row) => (
                  <tr key={row.key}>
                    <td>{row.sku || "Missing SKU"}</td>
                    <td><CompareCell row={row.before} currency={comparison.other.currency} /></td>
                    <td><CompareCell row={row.after} currency={review.currency} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="cf-note">No changes to display.</p>}
          <PageControls page={currentPage} lastPage={lastPage} total={rows.length} setPage={setPage} />
        </>
      )}
    </section>
  );
}

function ReviewContent({ details }) {
  const { review, entitlement, usage, catalogNotice, comparison, compareId, comparisonOptions, comparisonError, duplicate } = details;
  const [selected, setSelected] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const correction = useFetcher();
  const navigate = useNavigate();
  const correctionId = correction.state === "idle" ? correction.data?.correctionId : null;
  useEffect(() => {
    if (correctionId) navigate("/app/review/" + correctionId);
  }, [correctionId, navigate]);
  const locked = review.status === "FINALIZED";
  const canEdit = Boolean(entitlement.id) && !locked;
  const row = review.rows.find((item) => item.id === selected);
  const counts = { all: review.rows.length, ready: 0, matching: 0, approved: 0, excluded: 0 };
  for (const item of review.rows) counts[rowGroup(item)] += 1;
  const pending = counts.ready + counts.matching;
  const exceedsRowLimit = canEdit && review.rowCount > entitlement.maxRows;
  const allowanceUsed = canEdit && usage.remaining <= 0 && !review.parentId;
  const canCompare = locked && entitlement.canCompare;

  return (
    <s-page heading="Cost Review" inlineSize="large">
      <div className="cf-flow">
        <nav className="cf-row" aria-label="Review breadcrumb">
          <Link to={locked ? "/app/history" : "/app"}>{locked ? "History" : "Review Queue"}</Link>
          <span aria-hidden="true">/</span><span>Cost Review</span>
        </nav>
        <section className="cf-hero cf-review-hero" aria-labelledby="review-title">
          <div className="cf-hero-copy">
            <div className="cf-stack-sm">
              <p className="cf-kicker">Cost review · {review.supplierCode} · Version {review.revision}</p>
              <h2 id="review-title" className="cf-display">{review.supplierName}</h2>
              <p className="cf-muted cf-break cf-hero-source">{review.oldFilename} → {review.newFilename} · {review.currency}</p>
            </div>
            <div className="cf-row cf-hero-status">
              <ReviewStatus status={review.status} />
              <p className="cf-note">
                {locked ? "Finalized on " + formatDate(review.finalizedAt)
                  : pending ? pending + (pending === 1 ? " line still needs a decision" : " lines still need a decision") : "All lines reviewed"}
              </p>
            </div>
            <div className="cf-row cf-hero-actions">
              {locked ? (
                <>
                  <DownloadButton reviewId={review.id} primary />
                  {entitlement.canAudit && <DownloadButton reviewId={review.id} audit />}
                  {entitlement.id && (
                    <correction.Form method="post">
                      <input type="hidden" name="intent" value="correction" />
                      <input type="hidden" name="version" value={review.version} />
                      <button type="submit" className="cf-button" disabled={correction.state !== "idle"}>
                        {correction.state === "idle" ? "Create linked correction" : "Preparing correction…"}
                      </button>
                    </correction.Form>
                  )}
                </>
              ) : (
                <button
                  className="cf-button cf-primary" type="button" onClick={() => setFinalizing(true)}
                  disabled={!canEdit || pending > 0 || exceedsRowLimit || allowanceUsed}
                >
                  <WorkspaceIcon name="lock" /> Finalize and export
                </button>
              )}
              {review.parentId && <Link className="cf-button" to={"/app/review/" + review.parentId}>Open previous version</Link>}
            </div>
            <p className="cf-note">
              {locked ? "The source files and decisions are locked for this version."
                : pending ? "Match exceptions and approve or explicitly exclude every pending line." : "Finalize to lock this version and export approved costs."}
            </p>
            {!locked && !canEdit && <p><Link to="/app/plan">Choose a plan</Link> to update or finalize this review.</p>}
            <ErrorNotice error={correction.data?.error} />
          </div>
          <div className="cf-hero-art">
            <img src="/images/supplier-catalog.jpg" alt="Illustrative supplier catalog with a potted fern, ceramic tray and plant labels" />
            <span className="cf-art-label">Catalog imagery · illustrative</span>
          </div>
        </section>

        <div className="cf-summary" role="group" aria-label="Quote line totals">
          {reviewStats.map(([value, label, icon]) => (
            <div className={`cf-stat cf-stat-${value}`} key={value}>
              <span className="cf-stat-icon" aria-hidden="true"><WorkspaceIcon name={icon} /></span>
              <div className="cf-stat-copy"><strong>{counts[value]}</strong><small>{label}</small></div>
            </div>
          ))}
        </div>

        {duplicate && <p className="cf-success" role="status">This file pair already belongs to this review. Your existing work has been reopened.</p>}
        {catalogNotice && <p className="cf-warning">Could not check the latest Shopify variant matches. {catalogNotice}</p>}
        {review.stale && <p className="cf-warning">
          {locked
            ? "Shopify variant matches have changed since this review was finalized. Create a linked correction to review the current matches."
            : "Shopify variant matches have changed. Confirm the current matches or exclude those lines before finalizing."}
        </p>}
        {exceedsRowLimit && <p className="cf-warning">This review exceeds your current {entitlement.maxRows.toLocaleString("en")}-row allowance. <Link to="/app/plan">See plan limits</Link>.</p>}
        {allowanceUsed && <p className="cf-warning">Your monthly allowance is used. Finalized reviews remain available in History.</p>}

        <Rows review={review} locked={locked} canEdit={canEdit} openRow={setSelected} counts={counts} canCompare={canCompare} />
        {locked && (entitlement.canCompare || comparisonError) && (
          <VersionComparison review={review} comparison={comparison} compareId={compareId} comparisonOptions={comparisonOptions} comparisonError={comparisonError} />
        )}
        {row && <RowDialog key={row.id} review={review} row={row} canEdit={canEdit} close={() => setSelected(null)} />}
        {finalizing && <FinalizeDialog review={review} approved={counts.approved} excluded={counts.excluded} close={() => setFinalizing(false)} />}
      </div>
    </s-page>
  );
}

export default function CostReview() {
  const details = useLoaderData();
  if (details.error) {
    return (
      <s-page heading="Cost Review">
        <div className="cf-flow"><ErrorNotice error={details.error} /><div><Link to="/app">Return to Review Queue</Link></div></div>
      </s-page>
    );
  }
  return <ReviewContent key={details.review.id} details={details} />;
}

export const headers = boundary.headers;
