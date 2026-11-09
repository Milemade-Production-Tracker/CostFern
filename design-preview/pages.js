/* eslint-env es2020 */
(function () {
  "use strict";

  const dateFormat = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  const integerFormat = new Intl.NumberFormat("en-US");
  const finalized = (record) => ["finalized", "locked"].includes(String(record.status).toLowerCase());
  const canCompare = (tier) => tier === "growth" || tier === "pro";
  const number = (value) => integerFormat.format(Number(value) || 0);
  const glyph = (icon, name) => typeof icon === "function" ? icon(name) || "" : "";
  const version = (value) => "v" + String(value ?? 1).replace(/^v/i, "");

  function dateLabel(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
  }

  function initials(name) {
    return String(name || "").trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function heading(eyebrow, title, description, action = "") {
    return `<header class="page-head cf-secondary-head">
      <div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="lede">${description}</p></div>
      ${action}
    </header>`;
  }

  function stat(label, value, detail = "") {
    return `<div class="stat"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ""}</div>`;
  }

  function supplierActivity(suppliers, history) {
    const activity = new Map(suppliers.map((supplier) => [
      supplier.id, { supplier, versions: 0, approved: 0, excluded: 0, latest: null },
    ]));
    for (const record of history) {
      const entry = activity.get(record.supplier);
      if (!entry || !finalized(record)) continue;
      entry.versions++;
      entry.approved += Number(record.approved) || 0;
      entry.excluded += Number(record.excluded) || 0;
      if (record.date && (!entry.latest || new Date(record.date) > new Date(entry.latest))) entry.latest = record.date;
    }
    return [...activity.values()];
  }

  function minorUnits(value, places) {
    if (value == null || value === "") return null;
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    const digits = amount.toFixed(places).replace(".", "");
    return /^-?\d+$/.test(digits) ? BigInt(digits) : null;
  }

  function netChange(lines, places, expectedApproved) {
    if (!Array.isArray(lines)) return null;
    const approved = lines.filter((line) => line.status === "approved");
    if (approved.length !== expectedApproved) return null;
    let total = 0n;
    for (const line of approved) {
      const oldCost = minorUnits(line.old, places);
      const newCost = minorUnits(line.new, places);
      if (oldCost === null || newCost === null) return null;
      total += newCost - oldCost;
    }
    return total;
  }

  function netLabel(total, currency, places) {
    if (total === null) return "—";
    const sign = total < 0n ? "−" : total > 0n ? "+" : "";
    const digits = (total < 0n ? -total : total).toString().padStart(places + 1, "0");
    const integer = places ? digits.slice(0, -places) : digits;
    const fraction = places ? "." + digits.slice(-places) : "";
    return currency + " " + sign + integerFormat.format(BigInt(integer)) + fraction;
  }

  function supplierSummary(state, data, history) {
    const snapshots = state.snapshots || {};
    const suppliers = new Map(state.suppliers.map((supplier) => [supplier.id, supplier]));
    const latest = new Map();
    for (const record of history) {
      const seen = new Set([record.id]);
      let root = record.id;
      let parent = snapshots[root]?.parent;
      while (parent && !seen.has(parent)) {
        root = parent;
        seen.add(root);
        parent = snapshots[root]?.parent;
      }
      const key = record.supplier + "\0" + root;
      const previous = latest.get(key);
      if (!previous || Number(record.version) > Number(previous.version)) latest.set(key, record);
    }

    const groups = new Map();
    for (const record of latest.values()) {
      const supplier = suppliers.get(record.supplier);
      if (!supplier) continue;
      const snapshot = snapshots[record.id];
      const lines = snapshot?.lines ?? data.historyRows?.[record.id];
      const currency = snapshot?.currency || lines?.find((line) => line.currency)?.currency || supplier.currency;
      const key = supplier.id + "\0" + currency;
      const places = data.precision?.(currency) ?? new Intl.NumberFormat("en-US", {
        style: "currency", currency,
      }).resolvedOptions().maximumFractionDigits;
      const entry = groups.get(key) || { supplier, currency, places, batches: 0, approved: 0, excluded: 0, net: 0n };
      const approved = Number(record.approved) || 0;
      const delta = netChange(lines, places, approved);
      entry.batches++;
      entry.approved += approved;
      entry.excluded += Number(record.excluded) || 0;
      entry.net = entry.net === null || delta === null ? null : entry.net + delta;
      groups.set(key, entry);
    }
    return [...groups.values()];
  }

  function suppliers({ state, esc, icon }) {
    const directory = supplierActivity(state.suppliers, state.history);
    const currencies = new Set(state.suppliers.map((supplier) => supplier.currency)).size;
    const add = `<button type="button" class="btn primary" data-action="add-supplier">${glyph(icon, "plus")} Add supplier</button>`;
    return `<div class="cf-secondary">
      ${heading("Supplier workspace", "Suppliers", "Keep each vendor’s quotes, default currency, and review history together.", add)}
      <div class="stat-grid cf-secondary-stats">
        ${stat("Suppliers", esc(number(directory.length)), "Available for quote import")}
        ${stat("Currencies", esc(number(currencies)), "Configured defaults")}
        ${stat("With finalized reviews", esc(number(directory.filter((entry) => entry.versions > 0).length)), "Suppliers with review history")}
      </div>
      <section class="panel">
        <div class="panel-head"><div><h2>Supplier directory</h2><p class="muted">Use a unique code to identify each supplier across quote versions.</p></div></div>
        ${directory.length ? `<div class="table-scroll">
          <table class="cf-directory-table">
            <thead><tr><th scope="col">Supplier</th><th scope="col">Code</th><th scope="col">Default currency</th><th scope="col">Finalized versions</th><th scope="col">Last finalized</th><th scope="col">Action</th></tr></thead>
            <tbody>${directory.map(({ supplier, versions, latest }) => `<tr>
              <td><div class="cf-supplier-cell"><span class="cf-supplier-mark" aria-hidden="true">${esc(initials(supplier.name))}</span><strong>${esc(supplier.name)}</strong></div></td>
              <td><span class="cf-code">${esc(supplier.code)}</span></td>
              <td><span class="badge">${esc(supplier.currency)}</span></td>
              <td class="cf-tabular">${esc(number(versions))}</td>
              <td class="muted">${esc(dateLabel(latest))}</td>
              <td><button type="button" class="btn ghost cf-small-btn" data-action="edit-supplier" data-id="${esc(supplier.id)}" aria-label="Edit ${esc(supplier.name)}">Edit</button></td>
            </tr>`).join("")}</tbody>
          </table>
        </div>` : `<div class="empty"><strong>No suppliers yet</strong><p>Add your first supplier before uploading quotes.</p>${add}</div>`}
      </section>
    </div>`;
  }

  function history({ data = {}, state, esc, icon }) {
    const all = state.history.filter(finalized);
    const supplierNames = new Map(state.suppliers.map((supplier) => [supplier.id, supplier.name]));
    const filterAvailable = canCompare(state.tier);
    const currentFilter = filterAvailable ? state.historyFilter || "" : "";
    const visible = currentFilter ? all.filter((record) => record.supplier === currentFilter) : all;
    const reviewedSuppliers = new Set(all.map((record) => record.supplier)).size;
    const approved = all.reduce((sum, record) => sum + (Number(record.approved) || 0), 0);
    const auditAvailable = state.tier === "pro";
    const summary = auditAvailable ? supplierSummary(state, data, all) : [];
    return `<div class="cf-secondary">
      ${heading("Review archive", "History", "Reopen finalized decisions, compare versions, and download the approved costs.")}
      <div class="stat-grid cf-secondary-stats">
        ${stat("Finalized versions", esc(number(all.length)), "Locked source and decisions")}
        ${stat("Approved lines", esc(number(approved)), "Across saved versions")}
        ${stat("Suppliers reviewed", esc(number(reviewedSuppliers)), "Across the archive")}
      </div>
      ${auditAvailable ? `<section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Pro reporting</p><h2>Supplier summary</h2><p class="muted">Totals use the latest finalized version of each review. Net change includes approved lines only.</p></div><span class="badge">Pro</span></div>
        ${summary.length ? `<div class="table-scroll"><table class="cf-summary-table">
          <thead><tr><th scope="col">Supplier</th><th scope="col">Currency</th><th scope="col">Finalized batches</th><th scope="col">Approved lines</th><th scope="col">Excluded lines</th><th scope="col">Net unit cost change</th></tr></thead>
          <tbody>${summary.map(({ supplier, currency, places, batches, approved: approvedLines, excluded, net }) => `<tr>
            <td><strong>${esc(supplier.name)}</strong><div class="muted cf-cell-meta">${esc(supplier.code)}</div></td>
            <td>${esc(currency)}</td><td class="cf-tabular">${esc(number(batches))}</td><td class="cf-tabular">${esc(number(approvedLines))}</td><td class="cf-tabular">${esc(number(excluded))}</td><td class="cf-tabular">${esc(netLabel(net, currency, places))}</td>
          </tr>`).join("")}</tbody>
        </table></div>` : '<div class="empty"><p>Finalize a review to see supplier totals.</p></div>'}
      </section>` : ""}
      <section class="panel">
        <div class="panel-head cf-archive-head"><div><h2>Finalized reviews</h2><p class="muted">${esc(number(visible.length))} ${visible.length === 1 ? "version" : "versions"} shown</p></div>
          ${filterAvailable ? `<label class="cf-history-filter"><span>Filter by supplier</span><select data-input="history-filter">
            <option value="">All suppliers</option>
            ${state.suppliers.map((supplier) => `<option value="${esc(supplier.id)}"${supplier.id === currentFilter ? " selected" : ""}>${esc(supplier.name)}</option>`).join("")}
          </select></label>` : ""}
        </div>
        ${visible.length ? `<div class="table-scroll"><table class="cf-archive-table">
          <thead><tr><th scope="col">Review</th><th scope="col">Version</th><th scope="col">Decisions</th><th scope="col">Finalized</th><th scope="col">Actions</th></tr></thead>
          <tbody>${visible.map((record) => {
            const hasComparison = filterAvailable && all.some((other) => other.id !== record.id && other.supplier === record.supplier);
            return `<tr>
              <td><strong>${esc(record.name)}</strong><div class="muted cf-cell-meta">${esc(supplierNames.get(record.supplier) || record.supplier)}</div></td>
              <td><span class="badge">${esc(version(record.version))}</span></td>
              <td><strong class="cf-tabular">${esc(number(record.approved))} approved</strong><div class="muted cf-cell-meta">${esc(number(record.excluded))} excluded · ${esc(number(record.rows))} lines</div></td>
              <td class="muted">${esc(dateLabel(record.date))}</td>
              <td><div class="cf-archive-actions">
                <button type="button" class="btn ghost cf-small-btn" data-action="open-history" data-id="${esc(record.id)}">Open</button>
                ${hasComparison ? `<button type="button" class="btn ghost cf-small-btn" data-action="compare" data-id="${esc(record.id)}">Compare</button>` : ""}
                ${auditAvailable ? `<button type="button" class="btn ghost cf-small-btn" data-action="audit" data-id="${esc(record.id)}">${glyph(icon, "download")} Audit CSV</button>` : ""}
              </div></td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>` : `<div class="empty"><strong>${currentFilter ? "No finalized reviews for this supplier" : "No finalized reviews yet"}</strong><p>${currentFilter ? "Choose another supplier to see its review history." : "Finalized versions appear here after you lock a review."}</p></div>`}
      </section>
    </div>`;
  }

  const planDetails = {
    starter: { description: "For teams reviewing a few vendor updates each month.", features: ["SKU matching and quote review", "Approved cost CSV", "3-day trial for eligible stores"] },
    growth: { description: "For teams tracking more suppliers and price revisions.", features: ["Everything in Starter", "Supplier filtering", "Finalized version comparison"] },
    pro: { description: "For teams that need rollups and an approval trail.", features: ["Everything in Growth", "Cross-supplier summary", "Approval audit CSV"] },
  };

  function tierPrice(tier, frequency, esc) {
    const annual = frequency === "annual";
    if (annual && !tier.annual) return `<div class="cf-tier-price"><strong>$${esc(number(tier.monthly))}</strong><span>/ month</span></div><p class="muted">Monthly billing only</p>`;
    const amount = annual ? tier.annual : tier.monthly;
    return `<div class="cf-tier-price"><strong>$${esc(number(amount))}</strong><span>/ ${annual ? "year" : "month"}</span></div>
      <p class="muted">${annual ? "Billed annually" : tier.annual ? `Or $${esc(number(tier.annual))} billed annually` : "Billed monthly"}</p>`;
  }

  function plan({ data, state, esc, icon }) {
    const options = Array.isArray(data.plans) ? data.plans : Object.values(data.plans);
    const current = options.find((option) => option.id === state.tier) || options[0];
    const frequency = state.frequency === "annual" ? "annual" : "monthly";
    const billing = state.billing === "annual" ? "annual" : "monthly";
    const remaining = Math.max(0, current.quota - state.used);
    return `<div class="cf-secondary">
      ${heading("Subscription", "Plan & usage", "Compare review allowances and the tools available at each tier.", '<span class="badge">Preview only</span>')}
      <section class="panel cf-current-plan">
        <div class="panel-head"><div><p class="eyebrow">Current plan</p><h2>${esc(current.name)}</h2><p class="muted">${billing === "annual" ? "Annual" : "Monthly"} billing. A review uses one slot when it is first finalized.</p></div><span class="badge">Active in preview</span></div>
        <div class="cf-current-usage">
          <div><div class="cf-usage-label"><strong class="cf-tabular">${esc(number(state.used))} of ${esc(number(current.quota))}</strong><span class="muted">reviews finalized this month</span></div>
            <progress value="${esc(Math.min(Math.max(0, Number(state.used) || 0), current.quota))}" max="${esc(current.quota)}" aria-label="Monthly review usage"></progress>
            <p class="muted">${esc(number(remaining))} ${remaining === 1 ? "review" : "reviews"} remaining</p>
          </div>
          <div class="cf-current-limit"><strong class="cf-tabular">${esc(number(current.limit))}</strong><span class="muted">Maximum rows per review</span></div>
        </div>
      </section>
      <section class="cf-tier-section" aria-labelledby="cf-tier-heading">
        <div class="cf-tier-section-head"><div><h2 id="cf-tier-heading">Compare plans</h2><p class="muted">All prices shown in USD.</p></div>
          <div class="cf-interval-switch" role="group" aria-label="Billing frequency">
            ${["monthly", "annual"].map((interval) => `<button type="button" data-action="set-frequency" data-value="${interval}" aria-pressed="${interval === frequency}">${interval === "monthly" ? "Monthly" : "Annual"}</button>`).join("")}
          </div>
        </div>
        <div class="tier-grid">
          ${options.map((tier) => {
            const details = planDetails[tier.id];
            const selected = tier.id === current.id;
            const selectedInterval = selected && frequency === billing;
            const unavailable = frequency === "annual" && !tier.annual;
            const chooseLabel = unavailable ? "Monthly only" : selectedInterval ? "Current plan" : selected ? "Switch to " + frequency : "Choose " + esc(tier.name);
            return `<article class="tier cf-tier-card${selected ? " cf-tier-current" : ""}">
              <div class="cf-tier-heading"><h3>${esc(tier.name)}</h3>${selected ? '<span class="badge">Current</span>' : ""}</div>
              <p class="muted">${esc(details.description)}</p>
              <div class="cf-tier-rate">${tierPrice(tier, frequency, esc)}</div>
              <dl class="cf-tier-limits"><div><dt>Reviews per month</dt><dd>${esc(number(tier.quota))}</dd></div><div><dt>Rows per review</dt><dd>${esc(number(tier.limit))}</dd></div></dl>
              <ul class="cf-tier-features">${details.features.map((feature) => `<li><span aria-hidden="true">${glyph(icon, "check") || "✓"}</span>${esc(feature)}</li>`).join("")}</ul>
              <button type="button" class="btn ${selectedInterval || unavailable ? "ghost" : "primary"}" data-action="choose-plan" data-id="${esc(tier.id)}"${unavailable || selectedInterval ? " disabled" : ""}>${chooseLabel}</button>
            </article>`;
          }).join("")}
        </div>
        <p class="muted cf-preview-note">Switching plans here only changes the preview. It does not start a Shopify subscription.</p>
      </section>
    </div>`;
  }

  window.CostFernPages = { suppliers, history, plan };
})();
