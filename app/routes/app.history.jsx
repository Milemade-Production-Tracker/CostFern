/* eslint-disable react/prop-types */
import { useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listReviews, getSupplierSummary } from "../models/review.server.js";
import { listSuppliers } from "../models/quotes.server.js";
import { getEntitlement } from "../services/entitlements.server.js";
import { costLabel, DownloadButton, formatDate } from "../components/review-ui";
import { WorkspaceHeading, WorkspaceIcon } from "../components/workspace-ui.jsx";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const entitlement = await getEntitlement({ admin, session });
  const supplierId = entitlement.canCompare ? new URL(request.url).searchParams.get("supplier") : null;
  const [suppliers, reviews, summary] = await Promise.all([
    entitlement.canCompare ? listSuppliers(session.shop) : [],
    listReviews(session.shop, entitlement, supplierId || undefined),
    entitlement.canAudit ? getSupplierSummary(session.shop, entitlement) : null,
  ]);
  return { entitlement, supplierId, suppliers, reviews: reviews.filter((review) => review.status === "FINALIZED"), summary };
}

const number = new Intl.NumberFormat("en-US");
const PAGE_SIZE = 25;

function HistoryStats({ reviews, filtered }) {
  const stats = [
    { label: "Finalized versions", value: reviews.length, icon: "layers", note: "Locked sources and decisions" },
    { label: "Reviewed lines", value: reviews.reduce((total, review) => total + review.rowCount, 0), icon: "file", note: "Across these saved versions" },
    { label: "Suppliers reviewed", value: new Set(reviews.map((review) => review.supplierId)).size, icon: "box", note: filtered ? "In the current supplier view" : "Across the archive" },
  ];
  return (
    <section className="cf-history-stats" aria-label={filtered ? "Filtered archive totals" : "Archive totals"}>
      {stats.map(({ label, value, icon, note }) => (
        <div className="cf-card cf-row cf-history-stat" key={label}>
          <span className="cf-stat-icon" aria-hidden="true"><WorkspaceIcon name={icon} size={18} /></span>
          <div className="cf-stack-sm">
            <strong className="cf-numeric">{number.format(value)}</strong>
            <span>{label}</span>
            <span className="cf-note">{note}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function SupplierSummary({ summary }) {
  return (
    <section className="cf-card cf-stack cf-history-panel" aria-labelledby="supplier-summary">
      <div className="cf-split">
        <div className="cf-stack-sm">
          <p className="cf-kicker">Pro reporting</p>
          <h2 id="supplier-summary">Supplier summary</h2>
          <p className="cf-muted">Totals use the latest finalized version of each review. Net change includes approved lines only.</p>
        </div>
        <span className="cf-badge cf-good">Pro</span>
      </div>
      {summary?.length ? (
        <div className="cf-table-wrap">
          <table className="cf-table cf-summary-table">
            <thead><tr>
              <th scope="col">Supplier</th><th scope="col">Currency</th><th scope="col">Finalized batches</th>
              <th scope="col">Approved</th><th scope="col">Excluded</th><th scope="col">Net unit cost change</th>
            </tr></thead>
            <tbody>{summary.map((supplier) => (
              <tr key={supplier.supplierId + supplier.currency}>
                <td><strong>{supplier.name}</strong><p className="cf-note">{supplier.code}</p></td>
                <td><span className="cf-badge">{supplier.currency}</span></td>
                <td className="cf-numeric">{number.format(supplier.finalizedBatches)}</td>
                <td className="cf-numeric">{number.format(supplier.approved)}</td>
                <td className="cf-numeric">{number.format(supplier.excluded)}</td>
                <td className="cf-numeric">{costLabel(supplier.totalChange, supplier.currency)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="cf-empty cf-muted">Finalize a review to see its supplier totals.</p>}
    </section>
  );
}

function comparisonFor(review, reviews) {
  const siblings = reviews.filter((other) => other.id !== review.id && other.supplierId === review.supplierId);
  return siblings.find((other) => other.id === review.parentId)
    ?? siblings.find((other) => other.businessId === review.businessId)
    ?? siblings[0];
}

function FinalizedReviews({ reviews, canCompare, canAudit, supplierId }) {
  const [page, setPage] = useState(1);
  if (!reviews.length) {
    return (
      <div className="cf-empty">
        <strong>{supplierId ? "No finalized reviews for this supplier" : "No finalized reviews yet"}</strong>
        <p className="cf-muted">{supplierId ? "Choose another supplier to see its review history." : "Finalized versions appear here after you lock a review."}</p>
      </div>
    );
  }
  const lastPage = Math.ceil(reviews.length / PAGE_SIZE);
  const current = Math.min(page, lastPage);
  const start = (current - 1) * PAGE_SIZE;
  return (
    <>
      <div className="cf-table-wrap">
        <table className="cf-table cf-archive-table">
          <thead><tr>
            <th scope="col">Supplier and files</th><th scope="col">Version</th>
            <th scope="col">Lines reviewed</th><th scope="col">Finalized</th><th scope="col">Actions</th>
          </tr></thead>
          <tbody>{reviews.slice(start, start + PAGE_SIZE).map((review) => {
            const path = "/app/review/" + encodeURIComponent(review.id);
            const comparison = canCompare ? comparisonFor(review, reviews) : null;
            return (
              <tr key={review.id}>
                <td>
                  <Link to={path}><strong>{review.supplierName || review.supplier.name}</strong></Link>
                  <p className="cf-note cf-break">{review.oldFilename} → {review.newFilename}</p>
                </td>
                <td><span className="cf-badge">v{review.revision}</span></td>
                <td className="cf-numeric">{number.format(review.rowCount)}</td>
                <td>{formatDate(review.finalizedAt)}</td>
                <td>
                  <div className="cf-row cf-archive-actions">
                    <Link to={path} className="cf-button cf-button-sm">Open <WorkspaceIcon name="arrow" size={14} /></Link>
                    {comparison && (
                      <Link to={path + "?compare=" + encodeURIComponent(comparison.id) + "#compare-versions"} className="cf-button cf-button-sm">
                        <WorkspaceIcon name="compare" size={14} /> Compare
                      </Link>
                    )}
                    {canAudit && <DownloadButton reviewId={review.id} audit>Audit CSV</DownloadButton>}
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {lastPage > 1 && (
        <div className="cf-split cf-pagination">
          <p className="cf-note">{number.format(start + 1)}–{number.format(Math.min(start + PAGE_SIZE, reviews.length))} of {number.format(reviews.length)} reviews</p>
          <div className="cf-row">
            <button className="cf-button cf-button-sm" type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
            <button className="cf-button cf-button-sm" type="button" disabled={current === lastPage} onClick={() => setPage(current + 1)}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}

export default function History() {
  const { entitlement, supplierId, suppliers, reviews, summary } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  function filterSupplier(event) {
    const next = new URLSearchParams(searchParams);
    if (event.target.value) next.set("supplier", event.target.value);
    else next.delete("supplier");
    setSearchParams(next);
  }

  return (
    <s-page heading="History" inlineSize="large">
      <div className="cf-flow">
        <WorkspaceHeading
          eyebrow="Review archive"
          title="History"
          description="Reopen finalized decisions, download approved costs, or start a linked correction."
        />
        <HistoryStats reviews={reviews} filtered={Boolean(supplierId)} />
        {entitlement.canAudit && <SupplierSummary summary={summary} />}
        <section className="cf-card cf-stack cf-history-panel" aria-labelledby="finalized-reviews">
          <div className="cf-split">
            <div className="cf-stack-sm">
              <h2 id="finalized-reviews">Finalized reviews</h2>
              <p className="cf-muted">{number.format(reviews.length)} {reviews.length === 1 ? "version" : "versions"} shown</p>
            </div>
            {entitlement.canCompare && suppliers.length > 0 && (
              <label className="cf-field cf-filter">
                <span>Filter by supplier</span>
                <select value={supplierId || ""} onChange={filterSupplier}>
                  <option value="">All suppliers</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <FinalizedReviews
            key={supplierId || "all"}
            reviews={reviews}
            canCompare={entitlement.canCompare}
            canAudit={entitlement.canAudit}
            supplierId={supplierId}
          />
          <div className="cf-row">
            <Link to="/app">Open Review Queue</Link>
            {!entitlement.canCompare && <Link to="/app/plan">See plans for version comparison</Link>}
          </div>
        </section>
      </div>
    </s-page>
  );
}

export const headers = boundary.headers;
