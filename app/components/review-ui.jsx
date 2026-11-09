/* eslint-disable react/prop-types */
import { useState } from "react";
import { Link } from "react-router";
import { WorkspaceIcon } from "./workspace-ui";

const reviewStates = {
  DRAFT: ["Draft", ""],
  NEEDS_MATCHING: ["Needs matching", "cf-wait"],
  READY: ["Ready to review", "cf-info"],
  REVIEWED: ["Reviewed", "cf-info"],
  FINALIZED: ["Finalized", "cf-good"],
};
const issues = {
  MISSING_SKU: "Missing SKU",
  DUPLICATE_SOURCE_SKU: "Duplicate quote SKU",
  MISSING_OLD: "Missing old cost",
  MISSING_NEW: "Missing proposed cost",
  UNMATCHED: "No matching Shopify SKU",
  AMBIGUOUS: "Multiple Shopify matches",
  STALE: "Shopify SKU changed",
  VARIANT_IN_USE: "Variant already mapped",
};

export function ReviewStatus({ status }) {
  const [label, tone] = reviewStates[status] ?? reviewStates.DRAFT;
  return <span className={`cf-badge ${tone}`}>{label}</span>;
}

export function issueLabel(issue) {
  return issues[issue] ?? "";
}

export function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)) : "—";
}

export function costLabel(value, currency) {
  return value == null ? "—" : `${currency} ${value}`;
}

export function ErrorNotice({ error }) {
  return error ? <p className="cf-error" role="alert">{error}</p> : null;
}

export function Usage({ entitlement, usage }) {
  return (
    <aside className="cf-card cf-stack cf-usage" aria-label="Plan usage">
      <div className="cf-split">
        <div className="cf-stack-sm">
          <span className="cf-kicker">This allowance period</span>
          <h2>{entitlement.planName || "Choose a plan"}</h2>
        </div>
        {entitlement.id && <span className="cf-badge cf-info">{entitlement.maxRows.toLocaleString("en")} rows / review</span>}
      </div>
      {entitlement.id ? (
        <>
          <div className="cf-stack-sm">
            <p><strong>{usage.used} of {usage.limit}</strong> reviews finalized</p>
            <progress className="cf-meter" max={Math.max(1, usage.limit)} value={usage.used} aria-label="Finalized review allowance" />
            <p className="cf-muted">A review counts when you first finalize it.</p>
          </div>
          {usage.remaining <= 0 && <p className="cf-warning">Your allowance is used. You can still open and download finalized reviews.</p>}
        </>
      ) : (
        <p className="cf-muted">Select a plan to import quotes, review costs, and finalize new batches.</p>
      )}
      <div><Link className="cf-button" to="/app/plan">{entitlement.id ? "View plan" : "See plans"}<WorkspaceIcon name="arrow" /></Link></div>
    </aside>
  );
}

export function ReviewList({ reviews, empty, history = false }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const lastPage = Math.max(1, Math.ceil(reviews.length / pageSize));
  const current = Math.min(lastPage, page);
  const start = (current - 1) * pageSize;
  return reviews.length ? (
    <div className="cf-stack-sm">
      <div className="cf-table-wrap">
      <table className="cf-table">
        <thead><tr>
          <th scope="col">Supplier and files</th>
          <th scope="col">Status</th>
          <th scope="col">Version</th>
          <th scope="col">Rows</th>
          <th scope="col">{history ? "Finalized" : "Imported"}</th>
        </tr></thead>
        <tbody>{reviews.slice(start, start + pageSize).map((review) => (
          <tr key={review.id}>
            <td>
              <Link className="cf-record-link" to={`/app/review/${review.id}`}>
                <strong>{review.supplierName || review.supplier.name}</strong><WorkspaceIcon name="chevron" size={14} />
              </Link>
              <p className="cf-note cf-break">{review.oldFilename} → {review.newFilename}</p>
            </td>
            <td><ReviewStatus status={review.status} /></td>
            <td>v{review.revision}</td>
            <td className="cf-numeric">{review.rowCount}</td>
            <td>{formatDate(history ? review.finalizedAt : review.createdAt)}</td>
          </tr>
        ))}</tbody>
      </table>
      </div>
      {lastPage > 1 && (
        <div className="cf-split cf-pagination">
          <p className="cf-note">{start + 1}–{Math.min(start + pageSize, reviews.length)} of {reviews.length} reviews</p>
          <div className="cf-row">
            <button className="cf-button cf-button-sm" type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
            <button className="cf-button cf-button-sm" type="button" disabled={current === lastPage} onClick={() => setPage(current + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  ) : <div className="cf-empty"><p className="cf-muted">{empty}</p></div>;
}

export function DownloadButton({ reviewId, audit = false, primary = false, children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setError("");
    setBusy(true);
    try {
      await downloadReview(reviewId, audit);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cf-stack-sm">
      <button type="button" className={`cf-button${primary ? " cf-primary" : ""}`} onClick={download} disabled={busy}>
        <WorkspaceIcon name="download" />
        {busy ? "Preparing download…" : children || (audit ? "Download audit CSV" : "Download approved CSV")}
      </button>
      <ErrorNotice error={error} />
    </div>
  );
}

export async function downloadReview(reviewId, audit = false) {
  const kind = audit ? "audit" : "approved";
  const response = await fetch(`/app/review-download/${encodeURIComponent(reviewId)}?kind=${kind}`);
  if (!response.ok || !response.headers.get("Content-Type")?.includes("text/csv")) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "The download could not be prepared. Refresh the review and try again.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = response.headers.get("Content-Disposition")?.match(/filename="([a-z0-9-]+\.csv)"/i)?.[1] || `costfern-${kind}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
