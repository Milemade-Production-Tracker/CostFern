(function () {
  "use strict";

  const header = "sku,unit_cost,currency";
  const sampleQuotes = {
    old: [header, "CF-QA-FERN,10.00,USD", "CF-QA-TRAY,8.00,USD", "CF-QA-LABEL,2.00,USD",
      "CF-QA-MISSING,4.00,USD", "CF-QA-DUP-SOURCE,5.00,USD", "CF-QA-DUP-SOURCE,5.10,USD"].join("\n") + "\r\n",
    new: [header, "CF-QA-FERN,12.00,USD", "CF-QA-TRAY,7.00,USD", "CF-QA-LABEL,3.00,USD",
      "CF-QA-MISSING,5.00,USD", "CF-QA-DUP-SOURCE,5.25,USD"].join("\n") + "\r\n",
  };

  const variants = [
    { id: "demo-variant-fern", name: "CostFern QA — Fern pot", sku: "CF-QA-FERN", image: "fern" },
    { id: "demo-variant-tray", name: "CostFern QA — Tray", sku: "CF-QA-TRAY", image: "tray" },
    { id: "demo-variant-label-a", name: "CostFern QA — Label A", sku: "CF-QA-LABEL", image: "labels" },
    { id: "demo-variant-label-b", name: "CostFern QA — Label B", sku: "CF-QA-LABEL", image: "labels" },
    { id: "demo-variant-no-sku", name: "CostFern QA — No SKU", sku: "", image: "" },
  ];
  const suppliers = [
    { id: "demo-supplier-starter", code: "CF-QA-STARTER", name: "CostFern QA Supplier", currency: "USD" },
    { id: "demo-supplier-ui", code: "CF-QA-UI", name: "CostFern QA UI review", currency: "USD" },
    { id: "demo-supplier-pro", code: "CF-QA-PRO", name: "CostFern QA second supplier", currency: "USD" },
  ];
  const plans = [
    { id: "starter", name: "Starter", monthly: 39, annual: null, quota: 10, limit: 500 },
    { id: "growth", name: "Growth", monthly: 79, annual: 790, quota: 50, limit: 2000 },
    { id: "pro", name: "Pro", monthly: 129, annual: 1290, quota: 150, limit: 5000 },
  ];

  const minorUnitCodes = {
    0: "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF",
    2: `
      AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF
      CHE CHF CHW CNY COP COU CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD
      GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL
      MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR
      PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP
      TRY TTD TWD TZS UAH USD USN UYU UZS VED VES WST XAD XCD XCG YER ZAR ZMW ZWG`,
    3: "BHD IQD JOD KWD LYD OMR TND",
    4: "CLF UYW",
  };
  const currencyDigits = new Map(Object.entries(minorUnitCodes).flatMap(([digits, codes]) => (
    codes.trim().split(/\s+/u).map((code) => [code, Number(digits)])
  )));
  const maxBytes = 2 * 1024 * 1024;

  function csvError(label, line, message) {
    return new Error(`${label}, line ${line}: ${message}`);
  }

  function readCsv(source, label, limit) {
    if (typeof source !== "string" || !source.trim()) throw csvError(label, 1, "Choose a non-empty CSV file.");
    if (new TextEncoder().encode(source).byteLength > maxBytes) throw new Error(`${label} exceeds 2 MB.`);
    if (source.includes("\0") || source.includes("\ufffd")) throw csvError(label, 1, "Use a valid UTF-8 CSV file.");

    const records = [];
    let cells = [];
    let field = "";
    let state = "plain";
    let line = 1;
    let firstLine = 1;
    function finish() {
      cells.push(field);
      if (cells.length !== 1 || cells[0].trim()) {
        records.push({ cells, line: firstLine });
        if (records.length > limit + 1) throw new Error(`${label} exceeds the ${limit.toLocaleString("en-US")} row limit.`);
      }
      cells = [];
      field = "";
    }

    for (const character of source.replace(/^\ufeff/u, "").replace(/\r\n?/gu, "\n")) {
      if (state === "quoted") {
        if (character === '"') state = "closed";
        else field += character;
      } else if (state === "closed" && character === '"') {
        field += '"';
        state = "quoted";
      } else if (character === ",") {
        cells.push(field);
        if (cells.length >= 3) throw csvError(label, firstLine, "Expected exactly three columns.");
        field = "";
        state = "plain";
      } else if (character === "\n") {
        finish();
        firstLine = line + 1;
        state = "plain";
      } else if (state === "closed") {
        throw csvError(label, line, "Unexpected character after a quoted field.");
      } else if (character === '"') {
        if (field) throw csvError(label, line, "Unexpected quote in an unquoted field.");
        state = "quoted";
      } else {
        field += character;
      }
      if (character === "\n") line += 1;
    }
    if (state === "quoted") throw csvError(label, firstLine, "A quoted field is missing its closing quote.");
    finish();
    return records;
  }

  function parseQuote(source, label, limit) {
    const records = readCsv(source, label, limit);
    const heading = records.shift();
    if (heading?.cells.map((value) => value.trim()).join(",") !== header || heading.cells.length !== 3) {
      throw csvError(label, heading?.line ?? 1, `Use the header ${header}.`);
    }
    if (!records.length) throw csvError(label, heading.line, "Add at least one quote row.");

    let currency;
    const bySku = new Map();
    for (const { cells, line } of records) {
      if (cells.length !== 3) throw csvError(label, line, "Expected exactly three columns.");
      const [sku, amount, code] = cells.map((value) => value.trim());
      // eslint-disable-next-line no-control-regex
      if (sku.length > 255 || /[\x00-\x1f\x7f]/u.test(sku)) {
        throw csvError(label, line, "SKU must be 255 characters or fewer on one line.");
      }
      const rowCurrency = code.toUpperCase();
      const digits = currencyDigits.get(rowCurrency);
      if (digits === undefined) throw csvError(label, line, "Use a valid three-letter currency code such as USD or JPY.");
      if (currency && currency !== rowCurrency) throw csvError(label, line, "All rows in a quote must use the same currency.");
      currency = rowCurrency;
      const parts = /^(\d{1,20})(?:\.(\d+))?$/u.exec(amount);
      if (!parts || (parts[2]?.length ?? 0) > digits) {
        throw csvError(label, line, `Use a non-negative ${currency} amount with up to ${digits} decimal places and no currency symbols or separators.`);
      }
      const minorUnits = Number(`${parts[1]}${(parts[2] || "").padEnd(digits, "0")}`);
      const cost = minorUnits / (10 ** digits);
      if (!Number.isSafeInteger(minorUnits) || Number(cost.toFixed(digits).replace(".", "")) !== minorUnits) {
        throw csvError(label, line, "This amount is too large for the design preview.");
      }
      const group = bySku.get(sku) || [];
      group.push({ cost, line });
      bySku.set(sku, group);
    }
    return { currency, bySku };
  }

  function parseQuotes(oldText, newText, { supplier, limit = 500 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error("Choose a plan with a valid row limit.");
    const oldQuote = parseQuote(oldText, "Old quote", limit);
    const newQuote = parseQuote(newText, "New quote", limit);
    if (oldQuote.currency !== newQuote.currency) throw new Error("The old and new quotes must use the same currency.");
    const selectedSupplier = typeof supplier === "string" ? suppliers.find(({ id, code }) => id === supplier || code === supplier) : supplier;
    if (selectedSupplier?.currency && oldQuote.currency !== selectedSupplier.currency.toUpperCase()) {
      throw new Error(`The quotes must use the supplier’s currency (${selectedSupplier.currency}).`);
    }

    const rows = [];
    const skus = new Set([...oldQuote.bySku.keys(), ...newQuote.bySku.keys()]);
    function addRow(sku, oldRow, newRow, sourceIssue) {
      const candidates = sourceIssue ? [] : variants.filter((variant) => variant.sku === sku);
      const matched = candidates.length === 1 ? candidates[0] : null;
      const issue = sourceIssue || (matched ? "" : candidates.length > 1 ? "ambiguous" : "unmatched");
      const title = candidates.length > 1 ? "CostFern QA — Label A / Label B" : sku || "Missing SKU";
      rows.push({
        id: `row-${rows.length + 1}`, sku, name: matched?.name || title,
        old: oldRow?.cost ?? null, new: newRow?.cost ?? null, status: "pending", issue,
        oldLine: oldRow?.line ?? null, newLine: newRow?.line ?? null,
        image: candidates[0]?.image || "", variant: matched?.id || "",
      });
      if (rows.length > limit) throw new Error(`The compared quotes exceed the ${limit.toLocaleString("en-US")} row limit.`);
    }

    for (const sku of skus) {
      const oldRows = oldQuote.bySku.get(sku) || [];
      const newRows = newQuote.bySku.get(sku) || [];
      if (!sku || oldRows.length > 1 || newRows.length > 1) {
        const issue = sku ? "duplicate" : "missing-sku";
        for (const row of oldRows) addRow(sku, row, null, issue);
        for (const row of newRows) addRow(sku, null, row, issue);
      } else {
        const issue = !oldRows.length ? "missing-old" : !newRows.length ? "missing-new" : "";
        addRow(sku, oldRows[0], newRows[0], issue);
      }
    }
    return rows;
  }

  const seedRows = parseQuotes(sampleQuotes.old, sampleQuotes.new, { supplier: suppliers[0], limit: plans[0].limit });
  const starterReview = "demo-review-starter-v1";
  const proReview = "demo-review-pro-v1";
  const correction = "demo-review-ui-v2";
  const initialReview = "demo-review-ui-v1";

  function completedRows(approvedCount, notes, resolveLabel) {
    return seedRows.map((row, index) => ({
      ...row,
      ...(resolveLabel && row.issue === "ambiguous" ? { issue: "", name: variants[2].name, variant: variants[2].id } : {}),
      status: index < approvedCount ? "approved" : "excluded",
      note: notes[index] || "",
    }));
  }

  const starterPair = "starter-old.csv → starter-new.csv";
  const historyRows = {
    [starterReview]: completedRows(2, [null, null, "QA sample: omit this matched label from the export.",
      "QA sample: no Shopify variant for this SKU.", ...Array(3).fill("QA sample: duplicate supplier quote SKU.")], true),
    [proReview]: [{ ...seedRows[0], old: 12, new: 13, status: "approved", note: "" }],
    [correction]: completedRows(1, ["QA correction", ...Array(6).fill("QA correction changes the approved set")], false),
    [initialReview]: completedRows(2, [null, null, "QA confirmed Label A mapping; exclude this line from the approved export.",
      "QA supplier SKU has no matching Shopify variant.", ...Array(3).fill("QA duplicate SKU in supplier source quote.")], true),
  };
  const seedHistory = [
    { id: starterReview, supplier: suppliers[0].id, name: starterPair, version: 1, approved: 2, excluded: 5, rows: 7, status: "finalized", date: "2026-11-09T13:30:46.656Z" },
    { id: proReview, supplier: suppliers[2].id, name: "pro-old.csv → pro-new.csv", version: 1, approved: 1, excluded: 0, rows: 1, status: "finalized", date: "2026-11-09T12:38:37.549Z" },
    { id: correction, supplier: suppliers[1].id, name: starterPair, version: 2, approved: 1, excluded: 6, rows: 7, status: "finalized", date: "2026-11-09T12:36:24.873Z" },
    { id: initialReview, supplier: suppliers[1].id, name: starterPair, version: 1, approved: 2, excluded: 5, rows: 7, status: "finalized", date: "2026-11-09T12:33:41.995Z" },
  ];

  function csvDownload(filename, rows) {
    const fields = rows[0] && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : null;
    const records = fields ? [fields, ...rows.map((row) => fields.map((field) => row[field]))] : rows;
    const contents = `${records.map((cells) => cells.map((value) => {
      let text = String(value ?? "");
      if (typeof value === "string" && (/^[\t\r\n]/u.test(text) || /^\s*[=+\-@＝＋－＠]/u.test(text))) text = `'${text}`;
      return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(",")).join("\r\n")}\r\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return contents;
  }

  window.CostFernData = { seedRows, suppliers, plans, parseQuotes, csvDownload, seedHistory, historyRows, sampleQuotes, variants };
})();
