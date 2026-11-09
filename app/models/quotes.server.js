/* eslint-env es2020 */
import { createHash } from "node:crypto";
import prisma from "../db.server.js";

export const MAX_QUOTE_BYTES = 2 * 1024 * 1024;
const HEADERS = ["sku", "unit_cost", "currency"];
const shopPlans = new Set(["starter", "growth", "pro"]);

// ISO 4217 List One from the SIX maintenance agency, published 2026-09-17.
// https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html
// Intl locale defaults can use different precision from the ISO minor unit (e.g. IQD and HUF).
const minorUnitCodes = {
  0: "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF",
  2: `
    AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF
    CHE CHF CHW CNY COP COU CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD
    GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL
    MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR
    PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP
    TRY TTD TWD TZS UAH USD USN UYU UZS VED VES WST XAD XCD XCG YER ZAR ZMW ZWG`,
  3: "BHD IQD JOD KWD LYD OMR TND",
  4: "CLF UYW",
};
const currencyDigits = new Map(Object.entries(minorUnitCodes).flatMap(([digits, codes]) => (
  codes.trim().split(/\s+/u).map((code) => [code, Number(digits)])
)));

export class ReviewError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
    this.status = status;
  }
}

export function requirePlan(entitlement) {
  if (!shopPlans.has(entitlement?.id)) {
    throw new ReviewError("PLAN_REQUIRED", "An active plan is required for this action.", 403);
  }
}

export function requireCompare(entitlement) {
  requirePlan(entitlement);
  if (!entitlement.canCompare) {
    throw new ReviewError("GROWTH_REQUIRED", "Supplier filters and version comparison require Growth or Pro.", 403);
  }
}

export function requireAudit(entitlement) {
  requirePlan(entitlement);
  if (!entitlement.canAudit) {
    throw new ReviewError("PRO_REQUIRED", "This feature requires Pro.", 403);
  }
}

export async function withShopWrite(shop, sessionId, operation, { requireProducts = false } = {}) {
  return prisma.$transaction(async (tx) => {
    // A fresh statement snapshot after the lock observes any uninstall or redact that finished first.
    await tx.$queryRaw`SELECT true FROM pg_advisory_xact_lock(hashtextextended(${shop}, 0::bigint))`;
    if (sessionId != null) {
      const session = await tx.session.findFirst({ where: { id: sessionId, shop }, select: { scope: true } });
      if (!session) throw new ReviewError("SESSION_EXPIRED", "Reopen CostFern to continue.", 401);
      const scopes = new Set(session.scope?.split(/[,\s]+/u));
      if (requireProducts && !scopes.has("read_products") && !scopes.has("write_products")) {
        throw new ReviewError("PRODUCT_SCOPE_REQUIRED", "Shopify product access is required. Reopen CostFern and approve the product permission.", 403);
      }
    }
    return operation(tx);
  }, { isolationLevel: "ReadCommitted", timeout: 30000 });
}

export function normalizeCurrency(value) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!currencyDigits.has(currency)) {
    throw new ReviewError("INVALID_CURRENCY", "Enter a valid three-letter currency code, such as USD or JPY.");
  }
  return currency;
}

export function precision(currency) {
  return currencyDigits.get(currency);
}

export function cleanText(value, maxLength, label, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > maxLength || hasControlCharacters(text)) {
    throw new ReviewError("INVALID_TEXT", `${label} must ${required ? "contain 1 to" : "contain no more than"} ${maxLength} characters on one line.`);
  }
  return text;
}

function hasControlCharacters(text) {
  // Quote labels and SKUs are single-line values, including when they were quoted in CSV.
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/u.test(text);
}

export function minorUnits(value, currency) {
  const scale = precision(currency);
  const [integer, fraction = ""] = String(value).split(".");
  return BigInt(integer) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
}

export function formatMinor(value, scale) {
  const negative = value < 0n;
  const digits = String(negative ? -value : value).padStart(scale + 1, "0");
  const amount = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return negative ? `-${amount}` : amount;
}

export function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

function csvError(label, line, message) {
  return new ReviewError("CSV_FORMAT", `${label}, line ${line}: ${message}`);
}

function readCsv(source, label, maxRows) {
  const records = [];
  let fields = [];
  let field = "";
  let state = "plain";
  let line = 1;
  let recordLine = 1;
  function finishRecord() {
    fields.push(field);
    if (fields.length !== 1 || fields[0].trim() !== "") {
      records.push({ fields, line: recordLine });
      if (records.length > maxRows + 1) {
        throw new ReviewError("ROW_LIMIT", `${label} exceeds the ${maxRows.toLocaleString("en")} row limit for your plan.`, 422);
      }
    }
    fields = [];
    field = "";
  }
  for (const character of source) {
    if (state === "quoted") {
      if (character === '"') state = "closed";
      else field += character;
    } else if (state === "closed" && character === '"') {
      field += '"';
      state = "quoted";
    } else if (character === ",") {
      fields.push(field);
      field = "";
      state = "plain";
      if (fields.length >= HEADERS.length) throw csvError(label, recordLine, "Expected exactly three columns.");
    } else if (character === "\n") {
      finishRecord();
      recordLine = line + 1;
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
  if (state === "quoted") throw csvError(label, recordLine, "A quoted field is missing its closing quote.");
  finishRecord();
  return records;
}

export function parseQuoteCsv(value, label, maxRows) {
  let input;
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > MAX_QUOTE_BYTES) throw new ReviewError("FILE_LIMIT", `${label} exceeds 2 MB.`, 413);
    input = value;
  } else if (value instanceof Uint8Array) {
    if (value.byteLength > MAX_QUOTE_BYTES) throw new ReviewError("FILE_LIMIT", `${label} exceeds 2 MB.`, 413);
    try {
      input = new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
      throw csvError(label, 1, "Use a UTF-8 encoded CSV file.");
    }
  } else {
    throw csvError(label, 1, "Upload a CSV file.");
  }
  if (input.includes("\0") || input.includes("\ufffd")) throw csvError(label, 1, "Use a valid UTF-8 encoded CSV file.");
  const records = readCsv(input.replace(/^\ufeff/u, "").replace(/\r\n?/g, "\n"), label, maxRows);
  const header = records.shift();
  if (!header || header.fields.length !== HEADERS.length || !HEADERS.every((key, i) => key === header.fields[i].trim())) {
    throw csvError(label, header?.line ?? 1, "Use the header sku,unit_cost,currency.");
  }
  if (!records.length) throw csvError(label, header.line, "Add at least one quote row.");
  let quoteCurrency;
  const rows = records.map(({ fields, line }) => {
    if (fields.length !== HEADERS.length) throw csvError(label, line, "Expected exactly three columns.");
    const [sku, amount, code] = fields.map((value) => value.trim());
    if (sku.length > 255 || hasControlCharacters(sku)) {
      throw csvError(label, line, "SKU must be 255 characters or fewer on one line.");
    }
    let currency;
    try {
      currency = normalizeCurrency(code);
    } catch (error) {
      throw new ReviewError(error.code, `${label}, line ${line}: ${error.message}`);
    }
    if (quoteCurrency && quoteCurrency !== currency) {
      throw new ReviewError("CURRENCY_MISMATCH", `${label}, line ${line}: All rows in a quote must use the same currency.`);
    }
    quoteCurrency = currency;
    const digits = precision(currency);
    const parts = /^(\d{1,20})(?:\.(\d+))?$/u.exec(amount);
    if (!parts || (parts[2]?.length ?? 0) > digits) {
      throw new ReviewError("INVALID_COST", `${label}, line ${line}: Use a non-negative ${currency} amount with up to ${digits} decimal places and no currency symbols or separators.`);
    }
    return { sku, cost: formatMinor(minorUnits(amount, currency), digits), line };
  });
  return { currency: quoteCurrency, rows, fingerprint: fingerprint(value) };
}

export function parseQuotePair(oldCsv, newCsv, maxRows) {
  const oldQuote = parseQuoteCsv(oldCsv, "Old quote", maxRows);
  const newQuote = parseQuoteCsv(newCsv, "New quote", maxRows);
  if (oldQuote.currency !== newQuote.currency) {
    throw new ReviewError("CURRENCY_MISMATCH", "The old and new quotes must use the same currency.");
  }
  const contents = [oldQuote.currency, ...[oldQuote, newQuote].map(({ rows }) => rows.map(({ sku, cost }) => [sku, cost]))];
  return { oldQuote, newQuote, currency: oldQuote.currency, inputFingerprint: fingerprint(JSON.stringify(contents)) };
}

function csvCell(value, isNumeric) {
  let text = String(value ?? "");
  if (!isNumeric && (/^[\t\r\n]/u.test(text) || /^\s*[=+\-@＝＋－＠]/u.test(text))) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function encodeCsv(headers, rows, numericColumns = []) {
  const numeric = new Set(numericColumns);
  return `${[headers, ...rows].map((fields) => fields.map((value, index) => csvCell(value, numeric.has(index))).join(",")).join("\r\n")}\r\n`;
}

export function listSuppliers(shop) {
  return prisma.supplier.findMany({ where: { shop }, orderBy: [{ name: "asc" }, { id: "asc" }] });
}

export async function saveSupplier({ shop, sessionId, entitlement, id, code, name, currency }) {
  requirePlan(entitlement);
  if (id != null && typeof id !== "string") throw new ReviewError("NOT_FOUND", "Supplier not found.", 404);
  const normalizedCode = cleanText(code, 40, "Supplier code", true).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/u.test(normalizedCode)) {
    throw new ReviewError("INVALID_SUPPLIER_CODE", "Use letters, numbers, periods, hyphens or underscores for the supplier code.");
  }
  const data = { code: normalizedCode, name: cleanText(name, 120, "Supplier name", true), currency: normalizeCurrency(currency) };
  try {
    return await withShopWrite(shop, sessionId, async (tx) => {
      if (!id) return tx.supplier.create({ data: { shop, ...data } });
      const changed = await tx.supplier.updateMany({ where: { id, shop }, data });
      if (!changed.count) throw new ReviewError("NOT_FOUND", "Supplier not found.", 404);
      return tx.supplier.findUnique({ where: { shop_id: { shop, id } } });
    });
  } catch (error) {
    if (error.code === "P2002") throw new ReviewError("DUPLICATE_SUPPLIER", "This supplier code is already in use.", 409);
    throw error;
  }
}
