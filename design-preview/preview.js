(() => {
  "use strict";

  const data = window.CostFernData;
  const pages = window.CostFernPages;
  const app = document.querySelector("#app");
  const dialog = document.querySelector("#dialog");
  const notices = document.querySelector("#notices");
  const asset = "assets/supplier-catalog.png";
  const stateKey = "costfern-design-v3";
  const quoteNames = ["starter-old.csv", "starter-new.csv"];
  const now = "2026-11-09T13:30:46Z";
  const nav = [["queue", "Review Queue", "layers"], ["review", "Cost Review", "clipboard"], ["suppliers", "Suppliers", "box"], ["history", "History", "history"], ["plan", "Plan", "card"]];
  const paths = {
    leaf: '<path d="M5 19C5 11 11 5 20 4c-1 9-6 15-13 14M5 20c3-5 7-8 11-10"/><path d="M10 13 9 8m3 4 5 1"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    clipboard: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 11h6m-6 4h6"/>',
    box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7 5l9 4"/>',
    history: '<path d="M3 12a9 9 0 1 1 2.6 6.4M3 5v7h7m2-5v5l4 2"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
    store: '<path d="M4 9 6 4h12l2 5M4 9v2a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0V9H4Zm1 4v7h14v-7m-9 7v-5h4v5"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    circle: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2 1"/>',
    alert: '<path d="M10 4 3 17a2 2 0 0 0 2 3h14a2 2 0 0 0 2-3L14 4a2 2 0 0 0-4 0ZM12 9v4m0 3h.01"/>',
    minus: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
    upload: '<path d="M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5"/>',
    download: '<path d="M12 4v12m-4-4 4 4 4-4M5 17v3h14v-3"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="m14 6 4 4M5 19l4-.8L20 7l-3-3L6 15l-1 4Z"/>',
    compare: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
    external: '<path d="M13 4h7v7m0-7-9 9m7 0v7H4V6h7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2"/>',
    file: '<path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 13h6m-6 4h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 11h18"/>',
    spark: '<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  };

  function icon(name, size = 16) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.grid) + '</svg>';
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function fresh() {
    const snapshots = Object.fromEntries(data.seedHistory.map(item => {
      const supplier = data.suppliers.find(candidate => candidate.id === item.supplier);
      const parent = data.seedHistory.find(candidate => candidate.supplier === item.supplier && candidate.version === item.version - 1);
      return [item.id, {
        ...item,
        supplierName: supplier.name, currency: supplier.currency, parent: parent?.id,
        source: item.name.split(" → "), lines: structuredClone(data.historyRows[item.id]), finalized: true,
      }];
    }));
    return {
      tier: "pro", billing: "annual", frequency: "monthly", used: 1,
      suppliers: structuredClone(data.suppliers), history: structuredClone(data.seedHistory),
      historyFilter: "", queueFilter: "", snapshots,
      drafts: [{
        id: "november", supplier: data.suppliers[0].id, supplierName: data.suppliers[0].name,
        currency: data.suppliers[0].currency, source: quoteNames, version: 1,
        lines: structuredClone(data.seedRows), date: now, finalized: false,
      }],
    };
  }

  function read() {
    try { return JSON.parse(localStorage.getItem(stateKey)) || fresh(); } catch { return fresh(); }
  }
  function save() {
    try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch { /* Preview still works without browser storage. */ }
  }
  let state = read();
  let reviewFilter = "all";
  let search = "";
  let upload = {};
  let uploadError = "";
  let noticeTimer;

  const currentPlan = () => data.plans.find(plan => plan.id === state.tier);
  const supplierFor = id => state.suppliers.find(item => item.id === id);
  const route = () => (location.hash.replace(/^#\/?/u, "") || "review/november").split("/");
  const getReview = id => state.drafts.find(item => item.id === id) || state.snapshots[id];
  const getCurrentReview = () => getReview(route()[1] || "november") || state.drafts.at(-1) || Object.values(state.snapshots)[0];
  const currencyOf = review => review.currency || supplierFor(review.supplier)?.currency || "USD";
  const int = value => Number(value).toLocaleString("en-US");
  const date = value => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
  const amount = (value, currency) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  const csvAmount = (value, currency) => value == null ? "" :
    value.toFixed(new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().minimumFractionDigits);
  const kind = row => row.status !== "pending" ? row.status : row.issue || "ready";
  const labels = {
    ready: "Ready to review", ambiguous: "Ambiguous SKU", unmatched: "No Shopify match", duplicate: "Duplicate SKU",
    "missing-sku": "Missing SKU", "missing-old": "No old quote", "missing-new": "No new quote", approved: "Approved", excluded: "Excluded",
  };
  const isException = row => row.status === "pending" && Boolean(row.issue);
  const badge = row => '<span class="badge ' + esc(kind(row)) + '"><span class="dot"></span>' + labels[kind(row)] + '</span>';
  const action = (name, label, { id = "", value = "", glyph = "", cls = "", disabled = false } = {}) =>
    '<button type="button" class="btn ' + cls + '" data-action="' + name + '" data-id="' + esc(id) + '" data-value="' + esc(value) + '"' + (disabled ? " disabled" : "") + '>' + (glyph ? icon(glyph, 15) : "") + esc(label) + '</button>';
  const link = (href, label, { glyph = "", cls = "" } = {}) =>
    '<a class="btn ' + cls + '" href="#/' + esc(href) + '">' + (glyph ? icon(glyph, 15) : "") + esc(label) + '</a>';
  const thumb = row => '<span class="thumb ' + esc(row.image) + '">' + (row.image ? '<img src="' + asset + '" alt="">' : icon("box", 17)) + '</span>';
  const item = row => '<div class="item">' + thumb(row) + '<span><span class="item-name">' + esc(row.name.replace(/^CostFern QA — /u, "")) + '</span><span class="sku">' + esc(row.sku || "Missing SKU") + '</span></span></div>';

  function toast(message) {
    clearTimeout(noticeTimer);
    notices.innerHTML = '<div class="toast">' + esc(message) + '</div>';
    noticeTimer = setTimeout(() => notices.replaceChildren(), 3100);
  }

  function modal(title, body, { drawer = false, overline = "CostFern" } = {}) {
    dialog.className = drawer ? "drawer" : "";
    dialog.innerHTML = '<div class="dialog-head"><div><p class="eyebrow">' + esc(overline) + '</p><h2 id="dialog-title">' + esc(title) + '</h2></div><button class="icon-btn" type="button" data-action="close" aria-label="Close">' + icon("close") + '</button></div><div class="dialog-body">' + body + '</div>';
    if (!dialog.open) dialog.showModal();
    else dialog.querySelector("[data-action=close]").focus();
  }

  function changeMarkup(row, currency) {
    if (row.old == null || row.new == null) return "—";
    const delta = row.new - row.old;
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
    const pct = row.old === 0 && delta !== 0 ? "New cost" : row.old ? sign + Math.abs(delta / row.old * 100).toFixed(2) + "%" : "0.00%";
    const css = delta > 0 ? "change-up" : delta < 0 ? "change-down" : "";
    return '<span class="amount ' + css + '">' + sign + amount(Math.abs(delta), currency) + '</span><span class="change-pct">' + pct + '</span>';
  }

  function matchingRows(review) {
    return review.lines.filter(row => {
      const passes = reviewFilter === "all" || (reviewFilter === "exceptions" ? isException(row) : kind(row) === reviewFilter);
      return passes && (row.name + " " + row.sku).toLowerCase().includes(search.trim().toLowerCase());
    });
  }

  function resultsMarkup(review) {
    const rows = matchingRows(review);
    const currency = currencyOf(review);
    if (!rows.length) return '<div class="empty"><strong>No quote lines match these filters.</strong><p>Try another SKU or choose All lines.</p></div>';
    const visible = rows.slice(0, 100);
    const old = row => amount(row.old, currency);
    const proposed = row => amount(row.new, currency);
    const rowButton = row => action("details", review.finalized ? "Details" : "Review", { id: row.id, glyph: "chevron", cls: "ghost" });
    const table = visible.map(row => '<tr><td>' + item(row) + '</td><td class="amount">' + old(row) + '</td><td class="amount">' + proposed(row) + '</td><td>' + changeMarkup(row, currency) + '</td><td>' + badge(row) + '</td><td>' + rowButton(row) + '</td></tr>').join("");
    const cards = visible.map(row => '<article class="row-card">' + item(row) + '<div class="row-costs"><div><small>Old cost</small><span class="amount">' + old(row) + '</span></div><div><small>Proposed</small><span class="amount">' + proposed(row) + '</span></div><div><small>Change</small>' + changeMarkup(row, currency) + '</div></div><div class="inline">' + badge(row) + rowButton(row) + '</div></article>').join("");
    return '<div class="table-scroll review-table"><table><thead><tr><th scope="col">Variant / SKU</th><th scope="col">Old cost</th><th scope="col">Proposed cost</th><th scope="col">Change</th><th scope="col">Decision</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' + table + '</tbody></table></div><div class="review-cards">' + cards + '</div><p class="table-footer">Showing ' + int(visible.length) + ' of ' + int(rows.length) + ' quote lines · ' + esc(currency) + ' per unit' + (rows.length > visible.length ? ' · Search to find a specific SKU.' : '') + '</p>';
  }

  function reviewScreen(review) {
    const supplier = supplierFor(review.supplier);
    const counts = Object.fromEntries(["all", "ready", "exceptions", "approved", "excluded"].map(id => [
      id, review.lines.filter(row => id === "all" || (id === "exceptions" ? isException(row) : kind(row) === id)).length,
    ]));
    const pending = counts.ready + counts.exceptions;
    const limitReached = state.used >= currentPlan().quota && !review.parent;
    const tooMany = review.lines.length > currentPlan().limit;
    const blocked = pending > 0 || counts.approved === 0 || limitReached || tooMany;
    const status = review.finalized ? "Finalized " + date(review.date) : pending ? int(pending) + " lines need a decision" :
      limitReached ? "Monthly review allowance reached" : tooMany ? "Review exceeds the current row limit" :
      !counts.approved ? "Approve at least one line to finalize" : "Ready to finalize";
    const cta = review.finalized
      ? action("approved", "Download approved CSV", { id: review.id, glyph: "download", cls: "primary" }) +
        action("correction", "Create linked correction", { id: review.id, glyph: "plus" })
      : action("finalize", "Finalize & export", { id: review.id, glyph: "lock", cls: "primary", disabled: blocked }) +
        link("review/" + data.seedHistory[0].id, "View completed sample", { glyph: "arrow" });
    const stats = [["ready", "Ready to review", "circle"], ["exceptions", "Needs matching", "alert"], ["approved", "Approved", "check"], ["excluded", "Excluded", "minus"]].map(([id, label, glyph]) =>
      '<div class="stat"><span class="stat-icon ' + (id === "exceptions" ? "warn" : "") + '">' + icon(glyph, 17) + '</span><div><strong>' + int(counts[id]) + '</strong><span>' + label + '</span></div></div>').join("");
    const filters = [["all", "All lines"], ["ready", "Ready"], ["exceptions", "Exceptions"], ["approved", "Approved"], ["excluded", "Excluded"]].map(([id, label]) =>
      '<button type="button" aria-pressed="' + (reviewFilter === id) + '" data-action="filter" data-value="' + id + '">' + label + ' ' + int(counts[id]) + '</button>').join("");
    const addons = review.finalized && state.tier !== "starter" ? '<div class="actions">' +
      action("compare", "Compare versions", { id: review.id, glyph: "compare" }) +
      (state.tier === "pro" ? action("audit", "Download audit CSV", { id: review.id, glyph: "download" }) : "") + '</div>' : "";
    return '<section class="hero" aria-labelledby="review-heading"><div class="hero-copy"><p class="eyebrow">Cost review · ' + esc(supplier?.code) + ' · V' + review.version + '</p><h1 id="review-heading">November cost review</h1><p class="lede">' + esc(review.supplierName || supplier?.name) + ' · ' + esc(review.source.join(" → ")) + '</p><div class="actions">' + cta + '</div></div><div class="hero-art"><img src="' + asset + '" alt="Illustrative supplier catalog with a potted fern, ceramic tray and plant labels"><span class="photo-credit">Catalog imagery · illustrative</span></div></section>' +
      '<div class="stat-grid" aria-label="Review summary">' + stats + '</div>' +
      '<section class="panel" aria-labelledby="line-heading"><div class="panel-head"><div><h2 id="line-heading">Quote lines</h2><p>' + esc(status) + ' · Review the source, match and decision for each SKU.</p></div>' + addons + '</div><div class="filter-bar"><div class="segmented" aria-label="Decision filter">' + filters + '</div><label class="search">' + icon("search", 15) + '<input type="search" data-input="search" aria-label="Search SKU or variant" placeholder="Search SKU or variant" value="' + esc(search) + '"></label></div><div id="review-results">' + resultsMarkup(review) + '</div></section>';
  }

  function queueScreen() {
    const plan = currentPlan();
    const options = state.suppliers.map(item => '<option value="' + esc(item.id) + '"' + (upload.supplier === item.id ? " selected" : "") + '>' + esc(item.name + " · " + item.code + " · " + item.currency) + '</option>').join("");
    const files = ["old", "new"].map(part => '<label class="upload">' + icon("upload", 20) + '<span>' + (part === "old" ? "Old quote" : "New quote") + '</span><span class="upload-name">' + esc(upload[part]?.name || "Choose a CSV") + '</span><input type="file" accept=".csv,text/csv" aria-label="' + (part === "old" ? "Old quote CSV" : "New quote CSV") + '" data-input="file" data-part="' + part + '"></label>').join("");
    const rows = state.drafts.filter(review => !state.queueFilter || state.tier === "starter" || state.queueFilter === review.supplier).map(review =>
      '<tr><td><a class="item-name" href="#/review/' + esc(review.id) + '">' + esc(supplierFor(review.supplier)?.name) + '</a><span class="sku">' + esc(review.source.join(" → ")) + '</span></td><td><span class="badge ' + (review.lines.some(isException) ? "warn" : "ready") + '">' + (review.lines.some(isException) ? "Needs matching" : "In review") + '</span></td><td>V' + review.version + '</td><td>' + int(review.lines.length) + '</td><td>' + link("review/" + review.id, "Open review", { glyph: "arrow", cls: "ghost" }) + '</td></tr>').join("");
    return '<header class="page-head"><div><p class="eyebrow">01 · Supplier quotes</p><h1>Review Queue</h1><p class="lede">Turn two supplier quotes into a reviewable set of cost changes.</p></div>' + link("history", "View history", { glyph: "history" }) + '</header>' +
      '<div class="steps" aria-label="Review workflow"><span class="step current"><span class="step-num">01</span>Import quotes</span><span class="step"><span class="step-num">02</span>Match and review</span><span class="step"><span class="step-num">03</span>Finalize and export</span></div>' +
      '<div class="cols"><section class="panel"><div class="panel-head"><div><h2>Start a cost review</h2><p>Upload two UTF-8 files with SKU, unit cost and currency.</p></div></div><div class="panel-body stack"><label class="field">Supplier<select data-input="supplier" aria-label="Supplier"><option value="">Select supplier</option>' + options + '</select></label><div class="upload-grid">' + files + '</div>' + (uploadError ? '<p class="notice warn" role="alert">' + esc(uploadError) + '</p>' : "") + '<div class="actions">' + action("import", "Import and compare", { glyph: "arrow", cls: "primary" }) + action("sample", "Load sample files", { glyph: "file" }) + '</div><div class="inline muted"><small>Up to 2 MB per CSV</small><button class="text-button" data-action="sample-download" data-value="old">Old sample</button><button class="text-button" data-action="sample-download" data-value="new">New sample</button></div></div></section>' +
      '<aside class="panel"><div class="panel-head"><div><p class="eyebrow">Monthly allowance</p><h2>' + esc(plan.name) + '</h2></div><span class="badge">' + int(plan.limit) + ' rows / review</span></div><div class="panel-body"><strong>' + int(state.used) + ' of ' + int(plan.quota) + ' reviews finalized</strong><div class="usage-track" role="progressbar" aria-label="Monthly reviews" aria-valuemin="0" aria-valuemax="' + plan.quota + '" aria-valuenow="' + Math.min(state.used, plan.quota) + '"><span style="width:' + Math.min(100, state.used / plan.quota * 100) + '%"></span></div><p class="muted">A review counts when you first finalize it.</p><div class="actions" style="margin-top:12px">' + link("plan", "View plan", { glyph: "arrow" }) + '</div></div></aside></div>' +
      '<section class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>Open reviews</h2><p>Pick up a draft or check a matching exception.</p></div>' + (state.tier !== "starter" ? '<label class="field">Filter by supplier<select data-input="queue-filter"><option value="">All suppliers</option>' + state.suppliers.map(item => '<option value="' + esc(item.id) + '"' + (state.queueFilter === item.id ? " selected" : "") + '>' + esc(item.name) + '</option>').join("") + '</select></label>' : "") + '</div>' +
      (rows ? '<div class="table-scroll"><table><thead><tr><th>Supplier and files</th><th>Status</th><th>Version</th><th>Lines</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No open reviews for this selection.</div>') + '</section>';
  }

  function render() {
    const [name] = route();
    const page = nav.find(entry => entry[0] === name) || nav[1];
    const reviewHref = "review/" + (state.drafts.at(-1)?.id || data.seedHistory[0].id);
    const navigation = nav.map(([id, label, glyph]) => '<a href="#/' + (id === "review" ? reviewHref : id) + '"' + (page[0] === id ? ' class="active" aria-current="page"' : '') + '>' + icon(glyph, 17) + '<span>' + label + '</span></a>').join("");
    const ctx = { data, state, esc, icon };
    const contents = page[0] === "review" ? reviewScreen(getCurrentReview()) : page[0] === "queue" ? queueScreen() : pages[page[0]](ctx);
    document.title = "CostFern · " + page[1];
    app.innerHTML = '<div class="shell"><aside class="rail"><a class="brand" href="#/review/november"><span class="mark">' + icon("leaf", 25) + '</span><span><span class="brand-title">CostFern</span><span class="brand-caption">Supplier intelligence</span></span></a><p class="rail-label">Workspace</p><nav class="nav" aria-label="CostFern">' + navigation + '</nav><div class="rail-bottom"><p class="rail-note"><strong>CostFern test store</strong>Development-store sample</p></div></aside><div class="work"><header class="topbar"><div class="crumb"><span>Workspace</span>' + icon("chevron", 12) + '<strong>' + page[1] + '</strong></div><div class="toolbar"><span class="store-badge"><span class="store-dot">' + icon("store", 16) + '</span>CostFern test store</span><span class="preview-label">Interactive preview</span>' + action("settings", "Demo", { glyph: "settings", cls: "ghost" }) + '</div></header><main id="content" tabindex="-1">' + contents + '<footer class="footer"><span>CostFern · QA data from the Shopify development store</span><span>Sample imagery · UI preview only</span></footer></main></div></div>';
  }

  function rowDetails(review, row) {
    const currency = currencyOf(review);
    const costTile = (label, value, filename, line) => '<div class="quote-tile">' + label + '<strong>' + amount(value, currency) + '</strong>' + esc(filename) + (line == null ? ' · No source row' : ' · Row ' + line) + '</div>';
    const candidates = data.variants.filter(variant => variant.sku && (!row.sku || variant.sku === row.sku));
    const options = (candidates.length ? candidates : data.variants.filter(variant => variant.sku)).map(variant => '<option value="' + esc(variant.id) + '">' + esc(variant.name + " · " + variant.sku) + '</option>').join("");
    const matching = !review.finalized && ["ambiguous", "unmatched"].includes(row.issue) ? '<div class="stack"><label class="field">Shopify variant<select id="match-variant"><option value="">Select a variant</option>' + options + '</select></label><div>' + action("match", "Confirm match", { id: row.id, glyph: "check" }) + '</div></div>' : "";
    const decision = review.finalized
      ? (row.note ? '<div class="notice">Decision note · ' + esc(row.note) + '</div>' : "")
      : '<label class="field">Reason <small class="muted">Required when excluding a line.</small><textarea id="decision-note" maxlength="240" placeholder="Add context for the audit trail">' + esc(row.note) + '</textarea></label><div id="row-error" role="alert"></div><div class="actions">' +
        action("approve", "Approve line", { id: row.id, glyph: "check", cls: "primary", disabled: Boolean(row.issue) || row.status === "approved" }) +
        action("exclude", "Exclude line", { id: row.id, glyph: "minus" }) +
        (row.status !== "pending" ? action("reset-row", "Reset decision", { id: row.id, cls: "ghost" }) : "") + '</div>';
    modal(row.name.replace(/^CostFern QA — /u, ""), '<div class="inline"><span class="sku">' + esc(row.sku) + '</span>' + badge(row) + '</div>' +
      (row.image ? '<img class="drawer-photo" src="' + asset + '" alt="Illustrative supplier products">' : "") +
      '<div class="quote-tiles">' + costTile("Old quote", row.old, review.source[0], row.oldLine) +
      costTile("Proposed quote", row.new, review.source[1], row.newLine) + '</div><div class="inline"><strong>Unit cost change</strong>' + changeMarkup(row, currency) + '</div>' +
      (row.issue ? '<p class="notice warn">' + esc(labels[row.issue]) + '. Resolve the match or explicitly exclude this line.</p>' : "") + matching + decision,
    { drawer: true, overline: "Quote line details" });
  }

  function exportApproved(review) {
    const supplier = supplierFor(review.supplier);
    const currency = currencyOf(review);
    const rows = review.lines.filter(row => row.status === "approved").map(row => [
      review.supplierName || supplier?.name, row.variant, row.sku, csvAmount(row.old, currency), csvAmount(row.new, currency), currency, review.version, row.decidedAt || review.date,
    ]);
    data.csvDownload("costfern-approved-v" + review.version + ".csv", [
      ["supplier", "variant_id", "sku", "old_cost", "new_cost", "currency", "batch_version", "decided_at"], ...rows,
    ]);
    toast("Approved CSV downloaded · " + rows.length + " lines");
  }

  function audit(review) {
    if (state.tier !== "pro") return toast("Audit CSV is available on Pro.");
    const events = [["IMPORTED", "", "", "", review.date], ...review.lines.map(row => [
      "ROW_UPDATED", row.sku, row.status.toUpperCase(), row.note || "", row.decidedAt || review.date,
    ]), ["FINALIZED", "", "", "", review.date]];
    data.csvDownload("costfern-audit-v" + review.version + ".csv", [["event", "sku", "decision", "reason", "recorded_at"], ...events]);
    toast("Audit CSV downloaded · " + events.length + " events");
  }

  function compare(review, otherId = "") {
    if (state.tier === "starter") return toast("Version comparison is available on Growth and Pro.");
    const options = state.history.filter(item => item.id !== review.id && item.supplier === review.supplier);
    const other = getReview(otherId || options[0]?.id);
    const oldRows = new Map(other?.lines.map(row => [row.id, row]));
    const rows = review.lines.map(row => {
      const previous = oldRows.get(row.id);
      if (!previous || previous.sku !== row.sku || (row.status === previous.status && row.new === previous.new && row.note === previous.note)) return "";
      return '<tr><td>' + esc(row.sku) + '</td><td>' + esc(labels[kind(previous)]) + '</td><td>' + esc(labels[kind(row)]) + '</td><td class="amount">' + amount(row.new, currencyOf(review)) + '</td></tr>';
    }).filter(Boolean).join("");
    const content = options.length
      ? '<label class="field">Compare V' + review.version + ' with<select data-input="compare" data-id="' + esc(review.id) + '">' + options.map(option => '<option value="' + esc(option.id) + '"' + (option.id === other.id ? " selected" : "") + '>V' + option.version + ' · ' + esc(date(option.date)) + '</option>').join("") + '</select></label>' +
        (rows ? '<div class="table-scroll"><table><thead><tr><th>SKU</th><th>Compared decision</th><th>Current decision</th><th>Current proposed</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="empty">No decision or proposed cost differences.</p>')
      : '<p class="empty">This supplier needs another finalized version before you can compare.</p>';
    modal("Compare finalized versions", content, { overline: "Review history" });
  }

  function editSupplier(id) {
    const supplier = supplierFor(id);
    const field = (name, label, value, limit) => '<label class="field">' + label + '<input name="' + name + '" maxlength="' + limit + '" required value="' + esc(value) + '"></label>';
    modal(supplier ? "Edit supplier" : "Add supplier", '<form id="supplier-form" class="stack" data-id="' + esc(id) + '">' +
      field("name", "Supplier name", supplier?.name, 90) + field("code", "Supplier code", supplier?.code, 30) + field("currency", "Default currency", supplier?.currency || "USD", 3) +
      '<p id="supplier-error" role="alert"></p><button class="btn primary" type="submit">Save supplier</button></form>', { overline: "Supplier directory" });
  }

  function importQuotes() {
    try {
      const supplier = supplierFor(upload.supplier);
      if (!supplier) throw new Error("Choose the supplier for these quotes.");
      if (!upload.old || !upload.new) throw new Error("Choose both CSV files or load the sample quotes.");
      if (upload.old.error || upload.new.error) throw new Error(upload.old.error || upload.new.error);
      const lines = data.parseQuotes(upload.old.text, upload.new.text, { supplier, limit: currentPlan().limit });
      const id = "review-" + Date.now().toString(36);
      state.drafts.push({ id, supplier: supplier.id, supplierName: supplier.name, currency: supplier.currency,
        source: [upload.old.name, upload.new.name], version: 1, lines, date: now, finalized: false });
      upload = {};
      uploadError = "";
      save();
      location.hash = "/review/" + id;
      toast(int(lines.length) + " quote lines imported");
    } catch (error) {
      uploadError = error.message;
      render();
    }
  }

  function finalize(review) {
    const count = review.lines.filter(row => row.status === "approved").length;
    if (!count || review.lines.some(row => row.status === "pending") || review.lines.length > currentPlan().limit ||
        (!review.parent && state.used >= currentPlan().quota)) return toast("This review is not ready to finalize.");
    const completed = { ...review, date: now, finalized: true };
    state.snapshots[review.id] = completed;
    state.history.unshift({
      id: review.id, supplier: review.supplier, name: review.source.join(" → "), version: review.version,
      approved: count, excluded: review.lines.length - count, rows: review.lines.length, status: "finalized", date: now,
    });
    state.drafts = state.drafts.filter(item => item.id !== review.id);
    if (!review.parent) state.used += 1;
    save();
    dialog.close();
    render();
    exportApproved(completed);
  }

  function addCorrection(review) {
    const existing = state.drafts.find(item => item.parent === review.id);
    if (existing) { location.hash = "/review/" + existing.id; return; }
    const id = "correction-" + Date.now().toString(36);
    state.drafts.push({ ...review, id, parent: review.id, version: review.version + 1, finalized: false,
      lines: review.lines.map(row => ({ ...row, status: "pending", note: "", decidedAt: "" })) });
    save();
    location.hash = "/review/" + id;
    toast("Linked correction opened");
  }

  function handleAction(button) {
    const { action: command, id, value } = button.dataset;
    const review = getReview(id) || getCurrentReview();
    const row = review?.lines.find(item => item.id === id);
    if (command === "close") { dialog.close(); return; }
    if (command === "filter") { reviewFilter = value; render(); return; }
    if (command === "details" && row) { rowDetails(review, row); return; }
    if (["approve", "exclude", "reset-row", "match"].includes(command) && row && !review.finalized) {
      const note = dialog.querySelector("#decision-note")?.value.trim() || "";
      const error = dialog.querySelector("#row-error");
      if (command === "match") {
        const variant = data.variants.find(item => item.id === dialog.querySelector("#match-variant")?.value);
        if (!variant) { error.textContent = "Choose a Shopify variant."; return; }
        if (review.lines.some(item => item !== row && item.variant === variant.id)) { error.textContent = "This variant is already linked to another quote line."; return; }
        Object.assign(row, { variant: variant.id, issue: "", name: variant.name, image: variant.image });
      } else {
        if (command === "exclude" && !note) { error.textContent = "Enter a reason to exclude this line."; return; }
        if (command === "approve" && row.issue) return;
        Object.assign(row, { status: command === "approve" ? "approved" : command === "exclude" ? "excluded" : "pending", note: command === "reset-row" ? "" : note, decidedAt: now });
      }
      save(); render();
      if (command === "match") rowDetails(review, row);
      else { dialog.close(); app.querySelector('[data-action="details"][data-id="' + row.id + '"]')?.focus(); }
      return;
    }
    if (command === "sample") {
      upload = { supplier: upload.supplier || data.suppliers[0].id, old: { name: quoteNames[0], text: data.sampleQuotes.old }, new: { name: quoteNames[1], text: data.sampleQuotes.new } };
      uploadError = ""; render(); toast("Two sample quotes loaded"); return;
    }
    if (command === "sample-download") {
      const url = URL.createObjectURL(new Blob([data.sampleQuotes[value]], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = quoteNames[value === "old" ? 0 : 1]; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (command === "import") { importQuotes(); return; }
    if (command === "finalize") {
      const approved = review.lines.filter(item => item.status === "approved").length;
      modal("Finalize and export", '<p>Lock this version with ' + approved + ' approved and ' + (review.lines.length - approved) + ' excluded lines. You can download the same approved CSV again from History.</p><p class="notice">' + (review.parent ? "This linked correction uses no additional review." : "Finalizing uses one review from this month’s allowance.") + '</p><div class="actions">' + action("commit", "Lock review and download", { id: review.id, glyph: "download", cls: "primary" }) + '</div>', { overline: "Final decision" });
      return;
    }
    if (command === "commit") { finalize(review); return; }
    if (command === "approved") { exportApproved(review); return; }
    if (command === "audit") { audit(review); return; }
    if (command === "compare") { compare(review); return; }
    if (command === "correction") { addCorrection(review); return; }
    if (command === "open-history") { location.hash = "/review/" + id; return; }
    if (command === "add-supplier" || command === "edit-supplier") { editSupplier(id); return; }
    if (command === "set-frequency") { state.frequency = value; save(); render(); return; }
    if (command === "choose-plan") {
      const plan = data.plans.find(item => item.id === id);
      const period = plan.annual && state.frequency === "annual" ? "annual" : "monthly";
      modal("Preview " + plan.name, '<p>Apply ' + esc(plan.name) + ' ' + period + ' to this preview workspace.</p><p class="notice">Preview only. This does not change any Shopify subscription.</p><div>' + action("apply-plan", "Apply " + plan.name, { id, value: period, cls: "primary", glyph: "check" }) + '</div>', { overline: "Simulated plan selection" });
      return;
    }
    if (command === "apply-plan") {
      state.tier = id; state.billing = value; save(); dialog.close(); render(); toast(currentPlan().name + " preview applied"); return;
    }
    if (command === "settings") {
      modal("Preview controls", '<p>Explore a limit state or restore the original development-store sample.</p><div class="actions">' + action("set-usage", "Use last available slot", { value: "last" }) + action("set-usage", "Show allowance reached", { value: "full" }) + action("set-usage", "Restore 1 used", { value: "baseline" }) + '</div><div>' + action("reset-preview", "Reset this preview", { cls: "ghost" }) + '</div>', { overline: "Design preview" }); return;
    }
    if (command === "set-usage") {
      state.used = value === "last" ? currentPlan().quota - 1 : value === "full" ? currentPlan().quota : 1;
      save(); dialog.close(); render(); toast("Preview usage set to " + state.used); return;
    }
    if (command === "reset-preview") {
      state = fresh(); upload = {}; uploadError = ""; save(); dialog.close(); location.hash = "/review/november"; render(); toast("Preview reset");
    }
  }

  document.addEventListener("click", event => {
    if (event.target.closest(".skip")) {
      event.preventDefault();
      document.querySelector("#content").focus();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (button && !button.disabled) handleAction(button);
  });
  document.addEventListener("input", event => {
    if (event.target.dataset.input !== "search") return;
    search = event.target.value;
    document.querySelector("#review-results").innerHTML = resultsMarkup(getCurrentReview());
  });
  document.addEventListener("change", async event => {
    const field = event.target;
    const name = field.dataset.input;
    if (name === "supplier") upload.supplier = field.value;
    if (name === "history-filter") { state.historyFilter = field.value; save(); render(); }
    if (name === "queue-filter") { state.queueFilter = field.value; save(); render(); }
    if (name === "compare") compare(getReview(field.dataset.id), field.value);
    if (name !== "file" || !field.files?.length) return;
    const file = field.files[0];
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(file.name + " exceeds 2 MB.");
      upload[field.dataset.part] = { name: file.name, text: new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) };
      uploadError = "";
    } catch (error) {
      upload[field.dataset.part] = { name: file.name, error: error instanceof TypeError ? "Use a valid UTF-8 CSV file." : error.message };
      uploadError = upload[field.dataset.part].error;
    }
    if (route()[0] === "queue") render();
  });
  document.addEventListener("submit", event => {
    const form = event.target;
    if (form.id !== "supplier-form") return;
    event.preventDefault();
    const fields = new FormData(form);
    const id = form.dataset.id || "supplier-" + Date.now().toString(36);
    const name = String(fields.get("name")).trim();
    const code = String(fields.get("code")).trim().toUpperCase();
    const currency = String(fields.get("currency")).trim().toUpperCase();
    const error = form.querySelector("#supplier-error");
    if (!name || !/^[A-Z0-9][A-Z0-9_-]{0,29}$/u.test(code) || !/^[A-Z]{3}$/u.test(currency)) {
      error.textContent = "Enter a name, a valid supplier code and a three-letter currency.";
      return;
    }
    if (state.suppliers.some(item => item.code === code && item.id !== id)) {
      error.textContent = "This supplier code already exists.";
      return;
    }
    const previous = supplierFor(id);
    if (previous) Object.assign(previous, { name, code, currency });
    else state.suppliers.push({ id, name, code, currency });
    save(); dialog.close(); render(); toast("Supplier saved in the preview");
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#content") return;
    reviewFilter = "all"; search = ""; render(); window.scrollTo(0, 0);
  });
  render();
})();
