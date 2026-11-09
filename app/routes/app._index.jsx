/* eslint-disable react/prop-types */
import { useId, useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { importReview, listReviews, getUsage, ReviewError } from "../models/review.server.js";
import { listSuppliers } from "../models/quotes.server.js";
import { getCatalogSnapshot } from "../services/catalog.server.js";
import { getEntitlement } from "../services/entitlements.server.js";
import { readQuoteUpload, reviewActionError, reviewActor } from "../services/review-routes.server.js";
import { ErrorNotice, ReviewList, Usage } from "../components/review-ui";
import { WorkspaceHeading, WorkspaceIcon } from "../components/workspace-ui.jsx";

const workflowSteps = ["Import quotes", "Match and review", "Finalize and export"];

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const entitlement = await getEntitlement({ admin, session });
  const supplierId = entitlement.canCompare ? new URL(request.url).searchParams.get("supplier") : null;
  const [suppliers, allReviews, usage] = await Promise.all([
    listSuppliers(session.shop),
    listReviews(session.shop, entitlement, supplierId || undefined),
    getUsage(session.shop, entitlement),
  ]);
  return {
    entitlement,
    suppliers,
    supplierId,
    reviews: allReviews.filter((review) => review.status !== "FINALIZED"),
    usage,
  };
}

export async function action({ request }) {
  const context = await authenticate.admin(request);
  const { admin, session } = context;
  try {
    const entitlement = await getEntitlement({ admin, session });
    if (!entitlement.id) {
      throw new ReviewError("PLAN_REQUIRED", "Choose a plan before starting a new review.", 403);
    }
    const actor = reviewActor(context);
    const upload = await readQuoteUpload(request);
    const variants = await getCatalogSnapshot(admin, session);
    const review = await importReview({
      ...upload, shop: session.shop, sessionId: session.id, entitlement, variants, actor,
    });
    return redirect("/app/review/" + review.id + (review.duplicate ? "?notice=duplicate" : ""));
  } catch (error) {
    return reviewActionError(error);
  }
}

function QuoteUpload({ name, label }) {
  const descriptionId = useId();
  const [fileName, setFileName] = useState("");

  return (
    <label className="cf-field cf-upload-card cf-queue-upload">
      <span className="cf-queue-upload-icon"><WorkspaceIcon name="upload" size={20} /></span>
      <strong>{label}</strong>
      <span className="cf-queue-upload-name" id={descriptionId}>{fileName || "Choose a CSV"}</span>
      <input type="file" name={name} accept=".csv,text/csv" aria-label={`${label} CSV`} aria-describedby={descriptionId}
        onChange={(event) => setFileName(event.target.files[0]?.name || "")} required />
    </label>
  );
}

export default function ReviewQueue() {
  const { entitlement, suppliers, supplierId, reviews, usage } = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const importing = navigation.state !== "idle" && navigation.formMethod === "POST";

  function filterSupplier(event) {
    const next = new URLSearchParams(searchParams);
    if (event.target.value) next.set("supplier", event.target.value);
    else next.delete("supplier");
    setSearchParams(next);
  }

  return (
    <s-page heading="Review Queue" inlineSize="large">
      <div className="cf-flow">
        <WorkspaceHeading eyebrow="01 · Supplier quotes" title="Review Queue"
          description="Turn two supplier quotes into a reviewable set of cost changes.">
          <Link className="cf-button" to="/app/history"><WorkspaceIcon name="history" size={16} />View history</Link>
        </WorkspaceHeading>

        <ol className="cf-queue-steps" aria-label="Review workflow">
          {workflowSteps.map((step, index) => (
            <li className="cf-queue-step" key={step} aria-current={index === 0 ? "step" : undefined}>
              <span className="cf-queue-step-index" aria-hidden="true">0{index + 1}</span>{step}
            </li>
          ))}
        </ol>

        <div className="cf-columns cf-queue-grid">
          <section className="cf-card cf-stack cf-queue-import">
            <div className="cf-stack-sm">
              <h2>Start a cost review</h2>
              <p className="cf-muted">Upload two UTF-8 CSVs with <code>sku, unit_cost, currency</code>. Use the same currency in both files.</p>
            </div>
            <ErrorNotice error={result?.error} />
            {entitlement.id && suppliers.length > 0 ? (
              <Form method="post" encType="multipart/form-data" className="cf-stack">
                <fieldset disabled={importing} aria-busy={importing}>
                  <label className="cf-field">
                    <span>Supplier</span>
                    <select name="supplierId" defaultValue={supplierId || ""} required>
                      <option value="">Select supplier</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.code} · {supplier.currency}</option>
                      ))}
                    </select>
                  </label>
                  <div className="cf-columns-even cf-queue-upload-grid">
                    <QuoteUpload name="oldQuote" label="Old quote" />
                    <QuoteUpload name="newQuote" label="New quote" />
                  </div>
                  <div className="cf-row cf-queue-actions">
                    <button type="submit" className="cf-button cf-primary">
                      <WorkspaceIcon name="arrow" size={16} />{importing ? "Importing and matching…" : "Import and compare"}
                    </button>
                  </div>
                </fieldset>
              </Form>
            ) : (
              <div className="cf-empty">
                <p>{entitlement.id ? "Add your first supplier to start a review." : "Select a plan to start a review."}</p>
                <div className="cf-row">
                  <Link className="cf-button cf-primary" to={entitlement.id ? "/app/suppliers" : "/app/plan"}>
                    <WorkspaceIcon name={entitlement.id ? "plus" : "arrow"} size={16} />
                    {entitlement.id ? "Add supplier" : "See plans"}
                  </Link>
                </div>
              </div>
            )}
            <div className="cf-row cf-queue-samples">
              <span className="cf-note">Up to 2 MB per CSV</span>
              <a href="/samples/old-quote.csv" download>Old sample</a>
              <a href="/samples/new-quote.csv" download>New sample</a>
            </div>
          </section>
          <Usage entitlement={entitlement} usage={usage} />
        </div>

        <section className="cf-card cf-stack cf-queue-open">
          <div className="cf-split">
            <div className="cf-stack-sm">
              <h2>Open reviews</h2>
              <p className="cf-muted">Pick up a draft or resolve a matching exception.</p>
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
          <ReviewList key={supplierId || "all"} reviews={reviews} empty={supplierId ? "This supplier has no open reviews." : "No open reviews yet."} />
        </section>
      </div>
    </s-page>
  );
}

export const headers = boundary.headers;
