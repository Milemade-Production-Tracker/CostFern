import { randomUUID } from "node:crypto";
import prisma from "../db.server.js";
import {
  cleanText, encodeCsv, fingerprint, formatMinor, minorUnits, parseQuotePair,
  precision, requireAudit, requireCompare, requirePlan, ReviewError, withShopWrite,
} from "./quotes.server.js";

export { ReviewError };

const decisions = new Set(["PENDING", "APPROVED", "EXCLUDED"]);
const sourceIssues = new Set(["MISSING_SKU", "DUPLICATE_SOURCE_SKU", "MISSING_OLD", "MISSING_NEW"]);
const rowOrder = { position: "asc" };
const detail = { supplier: true, rows: { orderBy: rowOrder } };

function missingReview() {
  return new ReviewError("NOT_FOUND", "Review not found.", 404);
}

function requireVersion(review, version) {
  if (review.version !== Number(version)) {
    throw new ReviewError("VERSION_CONFLICT", "This review changed in another tab. Refresh before making more changes.", 409);
  }
}

function requireRowLimit(entitlement, rowCount) {
  const maxRows = Number.isInteger(entitlement.maxRows) ? entitlement.maxRows : 0;
  if (rowCount > maxRows) {
    throw new ReviewError("ROW_LIMIT", `Your plan allows up to ${maxRows.toLocaleString("en")} rows per review.`, 422);
  }
}

function actorId(actor, shop) {
  return cleanText(actor == null ? "" : String(actor), 160, "Approver ID") || `shop:${shop}`;
}

function fileName(filename, fallback) {
  const name = (typeof filename === "string" ? filename.split(/[/\\]/u).at(-1) : "") || fallback;
  return cleanText(name, 255, "Quote file name", true);
}

function variantRecord(variant) {
  if (!variant?.id || typeof variant.sku !== "string" || !variant.sku.trim()) return null;
  return {
    id: variant.id,
    sku: variant.sku.trim(),
    title: variant.title || "",
    productTitle: variant.productTitle || "",
    imageUrl: variant.imageUrl || null,
    imageAlt: variant.imageAlt || null,
  };
}

function catalogBySku(variants) {
  const bySku = new Map();
  const ids = new Set();
  for (const entry of variants) {
    const variant = variantRecord(entry);
    if (!variant || ids.has(variant.id)) continue;
    ids.add(variant.id);
    const candidates = bySku.get(variant.sku) ?? [];
    if (candidates.length < 20) candidates.push(variant);
    bySku.set(variant.sku, candidates);
  }
  return bySku;
}

function mapping(variant) {
  return {
    variantId: variant?.id ?? null,
    variantSku: variant?.sku ?? null,
    variantTitle: variant?.title ?? null,
    productTitle: variant?.productTitle ?? null,
    imageUrl: variant?.imageUrl ?? null,
    imageAlt: variant?.imageAlt ?? null,
  };
}

function matchLine(line, bySku) {
  const candidates = sourceIssues.has(line.issue) ? [] : (bySku.get(line.sku) ?? []);
  const variant = candidates.length === 1 ? candidates[0] : null;
  const issue = sourceIssues.has(line.issue)
    ? line.issue
    : candidates.length === 0 ? "UNMATCHED" : candidates.length > 1 ? "AMBIGUOUS" : null;
  return { ...line, issue, candidates, ...mapping(variant) };
}

function groupQuoteRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.sku) ?? [];
    group.push(row);
    groups.set(row.sku, group);
  }
  return groups;
}

function quoteLine(sku, oldRow, newRow, issue) {
  return {
    sku, oldCost: oldRow?.cost ?? null, newCost: newRow?.cost ?? null,
    oldLine: oldRow?.line ?? null, newLine: newRow?.line ?? null, issue,
  };
}

export function buildReviewRows(oldRows, newRows, variants) {
  if (!Array.isArray(variants)) throw new ReviewError("CATALOG_REQUIRED", "Load Shopify variants before comparing quotes.", 422);
  const oldGroups = groupQuoteRows(oldRows);
  const newGroups = groupQuoteRows(newRows);
  const skus = new Set([...oldGroups.keys(), ...newGroups.keys()]);
  const bySku = catalogBySku(variants);
  const rows = [];
  for (const sku of skus) {
    const before = oldGroups.get(sku) ?? [];
    const after = newGroups.get(sku) ?? [];
    if (!sku || before.length > 1 || after.length > 1) {
      const issue = sku ? "DUPLICATE_SOURCE_SKU" : "MISSING_SKU";
      for (const row of before) rows.push(quoteLine(sku, row, null, issue));
      for (const row of after) rows.push(quoteLine(sku, null, row, issue));
    } else {
      const issue = !before.length ? "MISSING_OLD" : !after.length ? "MISSING_NEW" : null;
      rows.push(quoteLine(sku, before[0], after[0], issue));
    }
  }
  return rows.map((row, position) => matchLine({ position, ...row }, bySku));
}

function statusFor(rows) {
  const pending = rows.filter((row) => !row.decision || row.decision === "PENDING");
  if (!pending.length) return "REVIEWED";
  return pending.some((row) => row.issue) ? "NEEDS_MATCHING" : "READY";
}

function amountText(amount, currency) {
  return amount == null ? null : formatMinor(minorUnits(amount, currency), precision(currency));
}

function percentText(delta, base) {
  const absolute = delta < 0n ? -delta : delta;
  const rounded = (absolute * 20000n + base) / (2n * base);
  return formatMinor(delta < 0n ? -rounded : rounded, 2);
}

function rowDisplay(row, currency) {
  const oldCost = amountText(row.oldCost, currency);
  const newCost = amountText(row.newCost, currency);
  if (oldCost == null || newCost == null) {
    return { ...row, oldCost, newCost, change: null, percentChange: null, changeKind: "UNAVAILABLE" };
  }
  const base = minorUnits(oldCost, currency);
  const delta = minorUnits(newCost, currency) - base;
  const changeKind = delta === 0n ? "UNCHANGED" : base === 0n ? "NEW_COST" : delta > 0n ? "INCREASE" : "DECREASE";
  return {
    ...row, oldCost, newCost, change: formatMinor(delta, precision(currency)), changeKind,
    percentChange: base === 0n ? null : percentText(delta, base),
  };
}

function currentSkuById(variants) {
  return Array.isArray(variants) ? new Map(variants.map((variant) => [variant.id, variantRecord(variant)?.sku])) : null;
}

function isStale(row, current) {
  return Boolean(current && row.variantId && current.get(row.variantId) !== row.variantSku);
}

function displayReview(review, variants) {
  if (!review.rows) return review;
  const current = currentSkuById(variants);
  const rows = review.rows.map((row) => ({ ...rowDisplay(row, review.currency), stale: isStale(row, current) }));
  return { ...review, rows, stale: rows.some((row) => row.stale && row.decision !== "EXCLUDED") };
}

async function loadReview(tx, shop, id, include = detail) {
  const review = await tx.reviewBatch.findUnique({ where: { shop_id: { shop, id } }, include });
  if (!review) throw missingReview();
  return review;
}

export async function getReview(shop, id, variants) {
  return displayReview(await loadReview(prisma, shop, id), variants);
}

export function listReviews(shop, entitlement, supplierId, { cursor, limit } = {}) {
  if (supplierId) requireCompare(entitlement);
  return prisma.reviewBatch.findMany({
    where: { shop, ...(supplierId ? { supplierId } : {}) },
    include: { supplier: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { shop_id: { shop, id: cursor } }, skip: 1 } : {}),
    ...(limit ? { take: Math.min(limit, 200) } : {}),
  });
}

async function addEvent(tx, review, kind, actor, details, createdAt = new Date()) {
  return tx.reviewEvent.create({
    data: { shop: review.shop, reviewId: review.id, version: review.version, kind, actor, details, createdAt },
  });
}

async function persistReview(tx, data, rows, kind, actor) {
  const review = await tx.reviewBatch.create({ data: { ...data, rowCount: rows.length, status: statusFor(rows) } });
  await tx.quoteLine.createMany({ data: rows.map((row) => ({ shop: review.shop, reviewId: review.id, ...row })) });
  await addEvent(tx, review, kind, actor, { rowCount: rows.length, parentId: review.parentId });
  return displayReview(await loadReview(tx, review.shop, review.id));
}

export async function importReview({ shop, sessionId, entitlement, supplierId, oldFilename, newFilename, oldCsv, newCsv, variants, actor }) {
  requirePlan(entitlement);
  requireRowLimit(entitlement, 1);
  if (typeof supplierId !== "string" || !supplierId) throw new ReviewError("SUPPLIER_REQUIRED", "Select a supplier before uploading quotes.");
  const quote = parseQuotePair(oldCsv, newCsv, entitlement.maxRows);
  const rows = buildReviewRows(quote.oldQuote.rows, quote.newQuote.rows, variants);
  requireRowLimit(entitlement, rows.length);
  return withShopWrite(shop, sessionId, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { shop_id: { shop, id: supplierId } } });
    if (!supplier) throw new ReviewError("NOT_FOUND", "Supplier not found.", 404);
    const duplicate = await tx.reviewBatch.findUnique({
      where: { shop_supplierId_inputFingerprint_revision: { shop, supplierId, inputFingerprint: quote.inputFingerprint, revision: 1 } },
      include: detail,
    });
    if (duplicate) return { ...displayReview(duplicate), duplicate: true };
    return persistReview(tx, {
      shop, supplierId, supplierCode: supplier.code, supplierName: supplier.name, businessId: randomUUID(),
      inputFingerprint: quote.inputFingerprint, oldFingerprint: quote.oldQuote.fingerprint, newFingerprint: quote.newQuote.fingerprint,
      oldFilename: fileName(oldFilename, "old-quote.csv"), newFilename: fileName(newFilename, "new-quote.csv"), currency: quote.currency,
    }, rows, "IMPORTED", actorId(actor, shop));
  }, { requireProducts: true });
}

function eventRow(row, currency) {
  return {
    rowId: row.id, sku: row.sku, oldCost: amountText(row.oldCost, currency), newCost: amountText(row.newCost, currency),
    oldLine: row.oldLine, newLine: row.newLine, issue: row.issue, variantId: row.variantId, variantSku: row.variantSku,
    decision: row.decision, note: row.note,
  };
}

function matchingIssue(row) {
  return row.candidates.length > 1 ? "AMBIGUOUS" : "UNMATCHED";
}

export async function updateReviewRow({ shop, sessionId, entitlement, reviewId, rowId, version, decision, variantId, variant, note, actor }) {
  requirePlan(entitlement);
  if (!decisions.has(decision)) throw new ReviewError("INVALID_DECISION", "Select a valid review decision.");
  const reason = cleanText(note, 500, "Decision reason", decision === "EXCLUDED");
  return withShopWrite(shop, sessionId, async (tx) => {
    const review = await loadReview(tx, shop, reviewId, { supplier: true });
    if (review.finalizedAt) throw new ReviewError("LOCKED", "This review is locked. Create a correction to make changes.", 409);
    requireVersion(review, version);
    const row = await tx.quoteLine.findFirst({ where: { id: rowId, reviewId, shop } });
    if (!row) throw new ReviewError("NOT_FOUND", "Review row not found.", 404);
    const decidedAt = new Date();
    const decidedBy = actorId(actor, shop);
    const data = {
      decision, note: reason || null, decidedAt: decision === "PENDING" ? null : decidedAt,
      decidedBy: decision === "PENDING" ? null : decidedBy,
    };
    if (variantId && (variantId !== row.variantId || variant)) {
      if (sourceIssues.has(row.issue)) throw new ReviewError("SOURCE_EXCEPTION", "This source row cannot be mapped. Exclude it or review corrected quotes.", 422);
      const selected = variantRecord(variant) ?? row.candidates.find(({ id }) => id === variantId);
      if (!selected || selected.id !== variantId) {
        throw new ReviewError("UNKNOWN_VARIANT", "Select an available Shopify variant with a SKU.", 422);
      }
      const used = await tx.quoteLine.findFirst({ where: { shop, reviewId, variantId, NOT: { id: row.id } }, select: { id: true } });
      if (used) throw new ReviewError("VARIANT_IN_USE", "This variant is already assigned to another row in the review.", 409);
      Object.assign(data, mapping(selected), { issue: null });
    } else if (variantId === "" && decision === "PENDING" && !sourceIssues.has(row.issue)) {
      Object.assign(data, mapping(null), { issue: matchingIssue(row) });
    }
    const next = { ...row, ...data };
    if (decision === "APPROVED" && (next.issue || !next.variantId || next.oldCost == null || next.newCost == null)) {
      throw new ReviewError("UNRESOLVED_ROW", "Resolve the matching exception or exclude this row before finalizing.", 422);
    }
    await tx.quoteLine.updateMany({ where: { id: row.id, reviewId, shop }, data });
    const statuses = await tx.quoteLine.groupBy({ by: ["issue"], where: { reviewId, shop, decision: "PENDING" } });
    const updated = await tx.reviewBatch.update({
      where: { shop_id: { shop, id: reviewId } }, data: { version: { increment: 1 }, status: statusFor(statuses) },
    });
    await addEvent(tx, updated, "ROW_UPDATED", decidedBy, {
      before: eventRow(row, review.currency), after: eventRow(next, review.currency),
    }, decidedAt);
    return displayReview(await loadReview(tx, shop, reviewId));
  }, { requireProducts: Boolean(variantId) || decision === "APPROVED" });
}

export async function getUsage(shop, entitlement) {
  const windowKey = entitlement?.windowKey || null;
  const limit = entitlement?.maxBatches ?? 0;
  const usage = windowKey ? await prisma.reviewUsage.findUnique({ where: { shop_windowKey: { shop, windowKey } } }) : null;
  const used = usage?.used ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used), windowKey };
}

async function settleUsage(tx, shop, entitlement) {
  const { maxBatches, windowKey, windowEndsAt } = entitlement;
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || !/^(?:dev:)?\d{4}-(?:0[1-9]|1[0-2])$/u.test(windowKey ?? "")) {
    throw new ReviewError("PLAN_REQUIRED", "An active plan and quota window are required to finalize.", 403);
  }
  if (windowEndsAt && Date.now() >= Date.parse(windowEndsAt)) {
    throw new ReviewError("QUOTA_WINDOW_ENDED", "Your quota window changed. Refresh and finalize again.", 409);
  }
  await tx.reviewUsage.upsert({ where: { shop_windowKey: { shop, windowKey } }, create: { shop, windowKey }, update: {} });
  const charged = await tx.reviewUsage.updateMany({ where: { shop, windowKey, used: { lt: maxBatches } }, data: { used: { increment: 1 } } });
  if (!charged.count) throw new ReviewError("BATCH_LIMIT", "Your monthly review limit has been reached. Existing approved downloads remain available.", 422);
  return windowKey;
}

function approvedCsv(review) {
  const approved = review.rows.filter((row) => row.decision === "APPROVED");
  return encodeCsv(
    ["supplier", "variant_id", "sku", "old_cost", "new_cost", "currency", "batch_version", "decided_at"],
    approved.map((row) => [
      review.supplierName, row.variantId, row.variantSku, amountText(row.oldCost, review.currency), amountText(row.newCost, review.currency),
      review.currency, review.revision, row.decidedAt.toISOString(),
    ]),
    [3, 4, 6],
  );
}

export async function finalizeReview({ shop, sessionId, entitlement, reviewId, version, variants, actor }) {
  requirePlan(entitlement);
  return withShopWrite(shop, sessionId, async (tx) => {
    const review = await loadReview(tx, shop, reviewId);
    if (review.finalizedAt) return displayReview(review);
    requireVersion(review, version);
    requireRowLimit(entitlement, review.rowCount);
    const pending = review.rows.filter((row) => row.decision === "PENDING").length;
    if (pending) throw new ReviewError("PENDING_ROWS", `Decide or explicitly exclude the ${pending} remaining ${pending === 1 ? "row" : "rows"}.`, 422);
    const current = currentSkuById(variants);
    if (!current) throw new ReviewError("CATALOG_REQUIRED", "Reload Shopify variants before finalizing.", 422);
    if (review.rows.some((row) => row.decision === "APPROVED" && isStale(row, current))) {
      throw new ReviewError("STALE_MAPPING", "Shopify SKU assignments changed. Confirm the current variants before finalizing.", 409);
    }
    const quotaWindowKey = review.revision === 1 ? await settleUsage(tx, shop, entitlement) : review.quotaWindowKey;
    const finalizedAt = new Date();
    const finalizedBy = actorId(actor, shop);
    const exportFingerprint = fingerprint(approvedCsv(review));
    const locked = await tx.reviewBatch.update({
      where: { shop_id: { shop, id: reviewId } },
      data: { status: "FINALIZED", version: { increment: 1 }, finalizedAt, finalizedBy, exportFingerprint, quotaWindowKey },
    });
    await addEvent(tx, locked, "FINALIZED", finalizedBy, {
      exportFingerprint, quotaWindowKey, approved: review.rows.filter((row) => row.decision === "APPROVED").length,
    }, finalizedAt);
    return displayReview({ ...review, ...locked });
  }, { requireProducts: true });
}

export async function createCorrection({ shop, sessionId, entitlement, reviewId, version, variants, actor }) {
  requirePlan(entitlement);
  if (!Array.isArray(variants)) throw new ReviewError("CATALOG_REQUIRED", "Reload Shopify variants before creating a correction.", 422);
  return withShopWrite(shop, sessionId, async (tx) => {
    const review = await loadReview(tx, shop, reviewId);
    if (!review.finalizedAt) throw new ReviewError("NOT_FINALIZED", "Finalize this review before creating a correction.", 422);
    requireVersion(review, version);
    const duplicate = await tx.reviewBatch.findFirst({ where: { shop, parentId: review.id }, include: detail });
    if (duplicate) return { ...displayReview(duplicate), duplicate: true };
    requireRowLimit(entitlement, review.rowCount);
    const bySku = catalogBySku(variants);
    const rows = review.rows.map(({ position, sku, oldCost, newCost, oldLine, newLine, issue }) => (
      matchLine({ position, sku, oldCost, newCost, oldLine, newLine, issue }, bySku)
    ));
    return persistReview(tx, {
      shop, supplierId: review.supplierId, supplierCode: review.supplierCode, supplierName: review.supplierName,
      businessId: review.businessId, parentId: review.id, revision: review.revision + 1, quotaWindowKey: review.quotaWindowKey,
      inputFingerprint: review.inputFingerprint, oldFingerprint: review.oldFingerprint, newFingerprint: review.newFingerprint,
      oldFilename: review.oldFilename, newFilename: review.newFilename, currency: review.currency,
    }, rows, "CORRECTION_CREATED", actorId(actor, shop));
  }, { requireProducts: true });
}

export async function getApprovedCsv(shop, id) {
  const review = await loadReview(prisma, shop, id);
  if (!review.finalizedAt) throw new ReviewError("NOT_FINALIZED", "Finalize this review to download approved rows.", 422);
  const csv = approvedCsv(review);
  if (review.exportFingerprint !== fingerprint(csv)) throw new ReviewError("EXPORT_INTEGRITY", "The locked export could not be verified.", 500);
  return csv;
}

export async function getAuditCsv(shop, id, entitlement) {
  requireAudit(entitlement);
  const review = await loadReview(prisma, shop, id, { events: { orderBy: { version: "asc" } } });
  if (!review.finalizedAt) throw new ReviewError("NOT_FINALIZED", "Finalize this review to download its approval audit.", 422);
  return encodeCsv([
    "supplier", "supplier_code", "review_id", "batch_version", "event_version", "event", "actor", "recorded_at", "source_sku",
    "old_cost", "new_cost", "currency", "old_line", "new_line", "previous_variant_id", "variant_id", "previous_decision",
    "decision", "reason", "exception", "old_quote", "new_quote", "old_quote_sha256", "new_quote_sha256", "approved_export_sha256",
    "business_batch_id", "parent_review_id", "quota_window",
  ], review.events.map(({ version, kind, actor, createdAt, details }) => {
    const { before, after } = details;
    return [
      review.supplierName, review.supplierCode, review.id, review.revision, version, kind, actor, createdAt.toISOString(), after?.sku,
      after?.oldCost, after?.newCost, review.currency, after?.oldLine, after?.newLine, before?.variantId, after?.variantId, before?.decision,
      after?.decision, after?.note, after?.issue, review.oldFilename, review.newFilename, review.oldFingerprint, review.newFingerprint,
      kind === "FINALIZED" ? review.exportFingerprint : null, review.businessId, review.parentId, review.quotaWindowKey,
    ];
  }), [3, 4, 9, 10, 12, 13]);
}

function comparisonRows(review) {
  const rows = new Map();
  for (const row of review.rows) {
    const identity = row.issue === "DUPLICATE_SOURCE_SKU" || row.issue === "MISSING_SKU"
      ? ["unpaired", row.sku, row.oldLine, row.newLine]
      : ["sku", row.sku];
    const key = JSON.stringify(identity);
    rows.set(key, row);
  }
  return rows;
}

export async function compareReviews(shop, entitlement, reviewId, compareId) {
  requireCompare(entitlement);
  const [review, other] = await Promise.all([getReview(shop, reviewId), getReview(shop, compareId)]);
  if (review.id === other.id || review.supplierId !== other.supplierId || !review.finalizedAt || !other.finalizedAt) {
    throw new ReviewError("INVALID_COMPARISON", "Select two finalized reviews for the same supplier.", 422);
  }
  const from = comparisonRows(other);
  const to = comparisonRows(review);
  const keys = new Set([...from.keys(), ...to.keys()]);
  const rows = [...keys].map((key) => {
    const before = from.get(key) ?? null;
    const after = to.get(key) ?? null;
    const changed = !before || !after || ["oldCost", "newCost", "variantId", "variantSku", "decision", "note", "issue"]
      .some((field) => before[field] !== after[field]) || other.currency !== review.currency;
    return { key, sku: (after ?? before).sku, before, after, changed };
  });
  return { review, other, rows };
}

export async function getSupplierSummary(shop, entitlement) {
  requireAudit(entitlement);
  const rows = await prisma.$queryRaw`
    WITH latest AS (
      SELECT DISTINCT ON ("businessId") * FROM "ReviewBatch"
      WHERE "shop" = ${shop} AND "status" = 'FINALIZED'
      ORDER BY "businessId", "revision" DESC
    )
    SELECT s."id" AS "supplierId", s."code", s."name", b."currency",
           COUNT(DISTINCT b."id")::integer AS "finalizedBatches",
           COUNT(*) FILTER (WHERE q."decision" = 'APPROVED')::integer AS "approved",
           COUNT(*) FILTER (WHERE q."decision" = 'EXCLUDED')::integer AS "excluded",
           COALESCE(SUM(q."newCost" - q."oldCost") FILTER (WHERE q."decision" = 'APPROVED'), 0) AS "totalChange"
    FROM latest b
    JOIN "Supplier" s ON s."shop" = b."shop" AND s."id" = b."supplierId"
    JOIN "QuoteLine" q ON q."shop" = b."shop" AND q."reviewId" = b."id"
    GROUP BY s."id", s."code", s."name", b."currency"
    ORDER BY s."name", s."code", b."currency"`;
  return rows.map((row) => ({ ...row, totalChange: row.totalChange.toFixed(precision(row.currency)) }));
}
