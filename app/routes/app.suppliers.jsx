/* eslint-disable react/prop-types */
import { useEffect, useId, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listSuppliers, saveSupplier } from "../models/quotes.server.js";
import { getEntitlement } from "../services/entitlements.server.js";
import { readReviewForm, reviewActionError } from "../services/review-routes.server.js";
import { ErrorNotice, formatDate } from "../components/review-ui";
import { WorkspaceHeading, WorkspaceIcon } from "../components/workspace-ui.jsx";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const [suppliers, entitlement] = await Promise.all([
    listSuppliers(session.shop),
    getEntitlement({ admin, session }),
  ]);
  return { suppliers, canEdit: Boolean(entitlement.id) };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  try {
    const form = await readReviewForm(request);
    const entitlement = await getEntitlement({ admin, session });
    const supplier = await saveSupplier({
      shop: session.shop, sessionId: session.id, entitlement,
      id: form.get("supplierId") || undefined,
      code: form.get("code"),
      name: form.get("name"),
      currency: form.get("currency"),
    });
    return { saved: supplier.name };
  } catch (error) {
    return reviewActionError(error);
  }
}

function SupplierForm({ supplier }) {
  const fetcher = useFetcher();
  const form = useRef(null);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (!busy && fetcher.data?.saved) form.current?.reset();
  }, [busy, fetcher.data]);
  return (
    <fetcher.Form ref={form} method="post" className="cf-stack">
      {supplier && <input type="hidden" name="supplierId" value={supplier.id} />}
      <fieldset disabled={busy} aria-busy={busy}>
        <div className="cf-columns-even">
          <label className="cf-field">
            <span>Supplier name</span>
            <input name="name" defaultValue={supplier?.name} required maxLength={120} placeholder="Northwind Supply" />
          </label>
          <label className="cf-field">
            <span>Supplier code</span>
            <input name="code" defaultValue={supplier?.code} required maxLength={40} placeholder="NORTHWIND" />
          </label>
        </div>
        <label className="cf-field">
          <span>Default currency</span>
          <input name="currency" defaultValue={supplier?.currency || "USD"} required maxLength={3} pattern="[A-Za-z]{3}" autoCapitalize="characters" />
          <span className="cf-note">Use a three-letter code such as USD, EUR, or JPY.</span>
        </label>
        <div className="cf-row">
          <button className="cf-button cf-primary" type="submit">{busy ? "Saving…" : supplier ? "Save changes" : "Add supplier"}</button>
        </div>
      </fieldset>
      <ErrorNotice error={fetcher.data?.error} />
      {fetcher.data?.saved && <p role="status" className="cf-success">{fetcher.data.saved} was saved.</p>}
    </fetcher.Form>
  );
}

function SupplierEditor({ supplier, onClose }) {
  const dialog = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="cf-dialog cf-flow cf-supplier-editor" aria-labelledby={titleId} onClose={onClose}>
      <div className="cf-split cf-dialog-head">
        <div className="cf-stack-sm">
          <p className="cf-kicker">Supplier directory</p>
          <h2 id={titleId}>{supplier ? "Edit supplier" : "Add supplier"}</h2>
        </div>
        <button type="button" className="cf-button cf-button-sm" onClick={() => dialog.current.close()}>Close</button>
      </div>
      <div className="cf-stack cf-dialog-body">
        <p className="cf-muted">Use a unique code to identify this supplier across quote versions.</p>
        <SupplierForm supplier={supplier} />
      </div>
    </dialog>
  );
}

export default function Suppliers() {
  const { suppliers, canEdit } = useLoaderData();
  const [editor, setEditor] = useState(null);
  const selected = editor?.supplierId ? suppliers.find(({ id }) => id === editor.supplierId) : undefined;
  const currencies = new Set(suppliers.map(({ currency }) => currency));
  const lastUpdated = suppliers.reduce((latest, { updatedAt }) => (
    !latest || new Date(updatedAt) > new Date(latest) ? updatedAt : latest
  ), null);

  return (
    <s-page heading="Suppliers" inlineSize="large">
      <div className="cf-flow">
        <WorkspaceHeading eyebrow="Supplier workspace" title="Suppliers"
          description="Keep each vendor’s quotes, default currency, and review history together.">
          {canEdit ? (
            <button type="button" className="cf-button cf-primary" onClick={() => setEditor({ supplierId: null })}>
              <WorkspaceIcon name="plus" size={16} />Add supplier
            </button>
          ) : <Link className="cf-button" to="/app/plan">See plans</Link>}
        </WorkspaceHeading>

        <div className="cf-supplier-stats" aria-label="Supplier directory overview">
          <div className="cf-card cf-supplier-stat">
            <span>Suppliers</span><strong>{suppliers.length.toLocaleString("en")}</strong><small>Available for quote import</small>
          </div>
          <div className="cf-card cf-supplier-stat">
            <span>Currencies</span><strong>{currencies.size.toLocaleString("en")}</strong><small>Configured defaults</small>
          </div>
          <div className="cf-card cf-supplier-stat">
            <span>Last update</span><strong>{formatDate(lastUpdated)}</strong><small>Most recent directory change</small>
          </div>
        </div>

        <section className="cf-card cf-stack cf-supplier-directory" aria-labelledby="supplier-directory">
          <div className="cf-stack-sm">
            <h2 id="supplier-directory">Supplier directory</h2>
            <p className="cf-muted">Use a unique code to identify each supplier across quote versions.</p>
            {!canEdit && <p className="cf-note">Select a plan to add or edit suppliers.</p>}
          </div>
          {suppliers.length ? (
            <div className="cf-table-wrap">
              <table className="cf-table cf-supplier-table" aria-labelledby="supplier-directory">
                <thead><tr>
                  <th scope="col">Supplier</th><th scope="col">Code</th><th scope="col">Default currency</th>
                  <th scope="col">Last updated</th>{canEdit && <th scope="col">Action</th>}
                </tr></thead>
                <tbody>{suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <div className="cf-supplier-identity">
                        <span className="cf-supplier-avatar" aria-hidden="true"><WorkspaceIcon name="box" size={16} /></span>
                        <strong className="cf-break">{supplier.name}</strong>
                      </div>
                    </td>
                    <td><span className="cf-supplier-code">{supplier.code}</span></td>
                    <td><span className="cf-badge">{supplier.currency}</span></td>
                    <td className="cf-muted">{formatDate(supplier.updatedAt)}</td>
                    {canEdit && <td className="cf-supplier-action">
                      <button type="button" className="cf-button cf-button-sm" aria-label={`Edit ${supplier.name}`}
                        onClick={() => setEditor({ supplierId: supplier.id })}>
                        <WorkspaceIcon name="edit" size={14} />Edit
                      </button>
                    </td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="cf-empty">
            <strong>No suppliers yet</strong>
            <p className="cf-muted">Add your first supplier before uploading quotes.</p>
          </div>}
        </section>

        {canEdit && editor && (editor.supplierId === null || selected) && (
          <SupplierEditor key={editor.supplierId || "add"} supplier={selected} onClose={() => setEditor(null)} />
        )}
      </div>
    </s-page>
  );
}

export const headers = boundary.headers;
