import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, test } from "node:test";

const testUrl = process.env.COSTFERN_TEST_DATABASE_URL;
if (testUrl) {
  const target = new URL(testUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/costfern_test") {
    throw new Error("CostFern integration tests require the isolated local costfern_test database.");
  }
  process.env.DATABASE_URL = testUrl;
}

const { MAX_QUOTE_BYTES, parseQuoteCsv, parseQuotePair, saveSupplier, listSuppliers } = await import("../app/models/quotes.server.js");
const {
  buildReviewRows, compareReviews, createCorrection, finalizeReview, getApprovedCsv, getAuditCsv,
  getReview, getSupplierSummary, getUsage, importReview, listReviews, updateReviewRow,
} = await import("../app/models/review.server.js");
const { default: prisma } = await import("../app/db.server.js");

const runId = `costfern-test-${randomUUID()}`;
const shops = new Set();
const variants = [variant(1, "@A"), variant(2, "B"), variant(3, "B"), variant(4, "C")];
const entitlements = [
  { id: "starter", maxBatches: 10, maxRows: 500, canCompare: false, canAudit: false },
  { id: "growth", maxBatches: 50, maxRows: 2000, canCompare: true, canAudit: false },
  { id: "pro", maxBatches: 150, maxRows: 5000, canCompare: true, canAudit: true },
].map((plan) => ({ ...plan, windowKey: "2026-11" }));
const [starter, growth, pro] = entitlements;
const noPlan = { id: null, maxBatches: 0, maxRows: 0, canCompare: false, canAudit: false, windowKey: null };

function variant(id, sku) {
  return { id: `gid://shopify/ProductVariant/${id}`, sku, title: `Variant ${id}`, productTitle: `Product ${id}` };
}

function csv(rows, currency = "USD") {
  return ["sku,unit_cost,currency", ...rows.map(([sku, value]) => `${sku},${value},${currency}`)].join("\n");
}

async function merchant(label, entitlement) {
  const shop = `${runId}-${label}.myshopify.com`;
  shops.add(shop);
  const session = await prisma.session.create({
    data: { id: `test-${shop}`, shop, state: "integration-test", scope: "read_products", accessToken: "local-test-only" },
  });
  const context = { shop, sessionId: session.id, entitlement, actor: "shopify-user:42" };
  const supplier = await saveSupplier({ ...context, code: "ACME", name: "=Acme", currency: "USD" });
  return { ...context, supplierId: supplier.id };
}

function upload(context, oldRows, newRows, catalog = variants) {
  return importReview({
    ...context, oldFilename: "Previous.csv", newFilename: "Current.csv",
    oldCsv: csv(oldRows), newCsv: csv(newRows), variants: catalog,
  });
}

function decide(context, review, sku, decision, details = {}) {
  return updateReviewRow({
    ...context, reviewId: review.id, rowId: review.rows.find((row) => row.sku === sku).id,
    version: review.version, decision, ...details,
  });
}

function finalize(context, review, catalog = variants) {
  return finalizeReview({ ...context, reviewId: review.id, version: review.version, variants: catalog });
}

function hasCode(code) {
  return (error) => error?.code === code;
}

after(async () => {
  if (!testUrl) return;
  const where = { shop: { in: [...shops] } };
  await prisma.$transaction([
    prisma.supplier.deleteMany({ where }), prisma.reviewUsage.deleteMany({ where }), prisma.session.deleteMany({ where }),
  ]);
  await prisma.$disconnect();
});

test("strict CSV accepts quoted fields, exact ISO currency precision and semantic fingerprints", () => {
  const quote = parseQuoteCsv('\ufeffsku,unit_cost,currency\r\n"A,B",1.005,KWD\r\n"A""C",0,KWD\r\n', "Quote", 2);
  assert.deepEqual(quote.rows, [{ sku: "A,B", cost: "1.005", line: 2 }, { sku: 'A"C', cost: "0.000", line: 3 }]);
  assert.equal(parseQuoteCsv(csv([["A", "0.0001"]], "CLF"), "Quote", 1).rows[0].cost, "0.0001");
  assert.equal(parseQuoteCsv(csv([["A", "0.001"]], "IQD"), "Quote", 1).rows[0].cost, "0.001");
  assert.equal(parseQuoteCsv(csv([["A", "0.01"]], "HUF"), "Quote", 1).rows[0].cost, "0.01");
  assert.equal(parseQuoteCsv(csv([["A", 7]], "JPY"), "Quote", 1).rows[0].cost, "7");
  assert.throws(() => parseQuoteCsv(csv([["A", "7.0"]], "JPY"), "Quote", 1), hasCode("INVALID_COST"));
  for (const amount of ["-1.00", "+2", "1e6", "1.999", "$2", "1.23.4"]) {
    assert.throws(() => parseQuoteCsv(csv([["A", amount]]), "Quote", 1), hasCode("INVALID_COST"));
  }
  assert.throws(() => parseQuoteCsv(csv([["A", "1"]], "ZZZ"), "Quote", 1), hasCode("INVALID_CURRENCY"));
  assert.throws(() => parseQuoteCsv("sku,unit_cost,currency\n\"bad,1,USD", "Quote", 1), hasCode("CSV_FORMAT"));
  assert.throws(() => parseQuoteCsv("sku,unit_cost,currency\nA,1,USD,X", "Quote", 1), hasCode("CSV_FORMAT"));
  assert.throws(() => parseQuoteCsv(Buffer.from([0xff]), "Quote", 1), hasCode("CSV_FORMAT"));
  assert.throws(() => parseQuoteCsv(Buffer.alloc(MAX_QUOTE_BYTES + 1), "Quote", 1), hasCode("FILE_LIMIT"));
  assert.throws(() => parseQuotePair(csv([["A", 1]]), csv([["A", 1]], "JPY"), 1), hasCode("CURRENCY_MISMATCH"));
  assert.throws(() => parseQuoteCsv("sku,unit_cost,currency\nA,1,USD\nB,1,GBP", "Quote", 2), hasCode("CURRENCY_MISMATCH"));
  const a = parseQuotePair(csv([["A", "1.0"]]), csv([["A", "1.50"]]), 1);
  const b = parseQuotePair(csv([["A", "1.00"]]).replaceAll("\n", "\r\n"), csv([["A", "1.5"]]), 1);
  assert.equal(a.inputFingerprint, b.inputFingerprint);
  assert.notEqual(a.oldQuote.fingerprint, b.oldQuote.fingerprint);
});

test("matching preserves duplicate, blank, unmatched, ambiguous, and one-sided source rows", () => {
  const old = [["DUP", 1], ["DUP", 2], ["", 1], ["B", 4], ["NOMATCH", 7], ["OLD", 1]];
  const next = [["DUP", 3], ["", 2], ["B", 3], ["NOMATCH", 8], ["NEW", 2]];
  const parsed = parseQuotePair(csv(old), csv(next), 20);
  const rows = buildReviewRows(parsed.oldQuote.rows, parsed.newQuote.rows, [...variants, variant(5, "")]);
  assert.deepEqual(rows.map(({ issue }) => issue), [
    "DUPLICATE_SOURCE_SKU", "DUPLICATE_SOURCE_SKU", "DUPLICATE_SOURCE_SKU", "MISSING_SKU", "MISSING_SKU",
    "AMBIGUOUS", "UNMATCHED", "MISSING_NEW", "MISSING_OLD",
  ]);
  assert.equal(rows.find(({ issue }) => issue === "AMBIGUOUS").candidates.length, 2);
  assert(rows.every(({ variantId }) => variantId === null));
});

test("review updates, one-to-one matching, idempotent finalization, audit, corrections, and tenant isolation", { skip: !testUrl }, async () => {
  const context = await merchant("flow", pro);
  const isolated = await merchant("isolated", pro);
  assert.equal((await listSuppliers(isolated.shop)).length, 1);
  assert.notEqual(context.supplierId, isolated.supplierId);
  await assert.rejects(saveSupplier({ ...context, entitlement: noPlan, code: "OTHER", name: "Other", currency: "USD" }), hasCode("PLAN_REQUIRED"));
  await assert.rejects(upload({ ...context, supplierId: isolated.supplierId }, [["@A", 1]], [["@A", 2]]), hasCode("NOT_FOUND"));
  await assert.rejects(upload(context, [["@A", 1]], [["@A", -2]]), hasCode("INVALID_COST"));
  assert.equal((await listReviews(context.shop, pro)).length, 0);

  const old = [["@A", "2.00"], ["B", "4.00"], ["C", "0.00"]];
  const next = [["@A", "2.50"], ["B", "3.00"], ["C", "0.33"]];
  const [initial, duplicate] = await Promise.all([upload(context, old, next), upload(context, old, next)]);
  assert.equal(initial.id, duplicate.id);
  assert.equal(Number(Boolean(initial.duplicate)) + Number(Boolean(duplicate.duplicate)), 1);
  assert.equal(initial.status, "NEEDS_MATCHING");
  assert.equal(initial.rows.find((row) => row.sku === "@A").percentChange, "25.00");
  assert.equal(initial.rows.find((row) => row.sku === "C").changeKind, "NEW_COST");
  assert.equal(initial.rows.find((row) => row.sku === "C").percentChange, null);
  await assert.rejects(finalize(context, initial), hasCode("PENDING_ROWS"));
  await assert.rejects(decide(context, initial, "B", "APPROVED"), hasCode("UNRESOLVED_ROW"));
  await assert.rejects(decide(context, initial, "B", "PENDING", { variantId: variants[0].id, variant: variants[0] }), hasCode("VARIANT_IN_USE"));
  const tabs = await Promise.allSettled([
    decide(context, initial, "@A", "APPROVED"),
    decide(context, initial, "C", "EXCLUDED", { note: "=Supplier withdrew this change" }),
  ]);
  assert.equal(tabs.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert(tabs.some((outcome) => outcome.status === "rejected" && hasCode("VERSION_CONFLICT")(outcome.reason)));
  let review = await getReview(context.shop, initial.id);
  if (review.rows.find((row) => row.sku === "@A").decision === "PENDING") review = await decide(context, review, "@A", "APPROVED");
  if (review.rows.find((row) => row.sku === "C").decision === "PENDING") {
    review = await decide(context, review, "C", "EXCLUDED", { note: "=Supplier withdrew this change" });
  }
  review = await decide(context, review, "B", "PENDING", { variantId: variants[1].id });
  review = await decide(context, review, "B", "APPROVED");
  assert.equal(review.status, "REVIEWED");
  const staleCatalog = [variant(1, "UPDATED-A"), ...variants.slice(1)];
  await assert.rejects(finalize(context, review, staleCatalog), hasCode("STALE_MAPPING"));
  assert.equal((await getUsage(context.shop, pro)).used, 0);
  const [final, replay] = await Promise.all([finalize(context, review), finalize(context, review)]);
  assert.equal(final.status, "FINALIZED");
  assert.equal(final.version, replay.version);
  assert.equal((await getUsage(context.shop, pro)).used, 1);
  await assert.rejects(decide(context, final, "B", "APPROVED"), hasCode("LOCKED"));
  const approved = await getApprovedCsv(context.shop, final.id);
  assert.equal(approved.trim().split("\r\n").length, 3);
  assert.match(approved, /'=Acme,gid:\/\/shopify\/ProductVariant\/1,'@A,2\.00,2\.50,USD,1,/u);
  assert.match(approved, /ProductVariant\/2,B,4\.00,3\.00,USD,1,/u);
  assert.equal((await getReview(context.shop, final.id, staleCatalog)).stale, true);
  await assert.rejects(getAuditCsv(context.shop, final.id, growth), hasCode("PRO_REQUIRED"));
  const audit = await getAuditCsv(context.shop, final.id, pro);
  assert.match(audit, /'=Supplier withdrew this change/u);
  assert.match(audit, /FINALIZED,shopify-user:42/u);
  assert.match(audit, new RegExp(final.exportFingerprint, "u"));
  await assert.rejects(getReview(isolated.shop, final.id), hasCode("NOT_FOUND"));
  await assert.rejects(getApprovedCsv(isolated.shop, final.id), hasCode("NOT_FOUND"));
  await assert.rejects(getAuditCsv(isolated.shop, final.id, pro), hasCode("NOT_FOUND"));
  await assert.rejects(Promise.resolve().then(() => listReviews(context.shop, starter, context.supplierId)), hasCode("GROWTH_REQUIRED"));
  assert.equal((await listReviews(context.shop, growth, context.supplierId)).length, 1);

  const corrected = await createCorrection({ ...context, reviewId: final.id, version: final.version, variants: staleCatalog });
  assert.equal(corrected.parentId, final.id);
  assert.equal(corrected.revision, 2);
  assert.equal(corrected.rows.find((row) => row.sku === "@A").issue, "UNMATCHED");
  let redo = await decide(context, corrected, "@A", "APPROVED", { variantId: staleCatalog[0].id, variant: staleCatalog[0] });
  redo = await decide(context, redo, "B", "APPROVED", { variantId: staleCatalog[1].id });
  redo = await decide(context, redo, "C", "EXCLUDED", { note: "Exclude from the correction" });
  const correctedFinal = await finalize(context, redo, staleCatalog);
  assert.equal((await getUsage(context.shop, pro)).used, 1);
  assert.equal(await getApprovedCsv(context.shop, final.id), approved);
  await assert.rejects(compareReviews(context.shop, starter, correctedFinal.id, final.id), hasCode("GROWTH_REQUIRED"));
  const comparison = await compareReviews(context.shop, growth, correctedFinal.id, final.id);
  assert.equal(comparison.rows.find((row) => row.sku === "@A").changed, true);
  const otherSupplier = await saveSupplier({ ...context, code: "OTHER", name: "Other", currency: "USD" });
  const otherContext = { ...context, supplierId: otherSupplier.id };
  let other = await upload(otherContext, [["@A", 1]], [["@A", 2]]);
  other = await decide(otherContext, other, "@A", "APPROVED");
  await finalize(otherContext, other);
  const summary = await getSupplierSummary(context.shop, pro);
  assert.equal(summary.length, 2);
  assert.deepEqual(summary.find((row) => row.code === "ACME"), {
    supplierId: context.supplierId, code: "ACME", name: "=Acme", currency: "USD", finalizedBatches: 1, approved: 2, excluded: 1, totalChange: "-0.50",
  });
  await assert.rejects(getSupplierSummary(context.shop, growth), hasCode("PRO_REQUIRED"));

  await prisma.session.update({ where: { id: context.sessionId }, data: { scope: "" } });
  await assert.rejects(upload(context, [["@A", 9]], [["@A", 8]]), hasCode("PRODUCT_SCOPE_REQUIRED"));
  await prisma.session.delete({ where: { id: context.sessionId } });
  await assert.rejects(saveSupplier({ ...context, code: "REMOVED", name: "Removed", currency: "USD" }), hasCode("SESSION_EXPIRED"));
});

for (const entitlement of entitlements) {
  test(`${entitlement.id} persists ${entitlement.maxRows} rows and enforces its monthly ${entitlement.maxBatches} batch limit under concurrency`, { skip: !testUrl }, async () => {
    const context = await merchant(entitlement.id, entitlement);
    const lines = Array.from({ length: entitlement.maxRows + 1 }, (_, i) => [`SKU-${i}`, "1.00"]);
    const catalog = lines.map(([sku], i) => variant(10000 + i, sku));
    const maximum = lines.slice(0, entitlement.maxRows);
    const importAtCap = await upload(context, maximum, maximum, catalog);
    assert.equal(importAtCap.rows.length, entitlement.maxRows);
    assert.equal(importAtCap.rows.at(-1).variantId, catalog[entitlement.maxRows - 1].id);
    if (entitlement.id !== "starter") {
      await assert.rejects(finalize({ ...context, entitlement: starter }, importAtCap, catalog), hasCode("ROW_LIMIT"));
    }
    await assert.rejects(upload(context, lines, lines, catalog), hasCode("ROW_LIMIT"));
    const combined = [...maximum.slice(1), lines.at(-1)];
    await assert.rejects(upload(context, maximum, combined, catalog), hasCode("ROW_LIMIT"));
    assert.equal((await getUsage(context.shop, entitlement)).used, 0);

    // Seed previously settled usage to exercise the exact boundary without hundreds of fixture reviews.
    await prisma.reviewUsage.create({ data: { shop: context.shop, windowKey: entitlement.windowKey, used: entitlement.maxBatches - 1 } });
    let one = await upload(context, [["@A", 1]], [["@A", 2]]);
    let two = await upload(context, [["@A", 2]], [["@A", 3]]);
    one = await decide(context, one, "@A", "APPROVED");
    two = await decide(context, two, "@A", "APPROVED");
    const results = await Promise.allSettled([finalize(context, one), finalize(context, two)]);
    const finalized = results.find((result) => result.status === "fulfilled");
    assert(finalized);
    assert(results.some((result) => result.status === "rejected" && hasCode("BATCH_LIMIT")(result.reason)));
    const remaining = finalized.value.id === one.id ? two : one;
    assert.equal((await getReview(context.shop, remaining.id)).status, "REVIEWED");
    assert.deepEqual(await getUsage(context.shop, entitlement), {
      used: entitlement.maxBatches, limit: entitlement.maxBatches, remaining: 0, windowKey: entitlement.windowKey,
    });
    assert.match(await getApprovedCsv(context.shop, finalized.value.id), /ProductVariant\/1/u);
    await assert.rejects(finalize({ ...context, entitlement: noPlan }, remaining), hasCode("PLAN_REQUIRED"));
    assert.match(await getApprovedCsv(context.shop, finalized.value.id), /ProductVariant\/1/u);
    const newWindow = { ...context, entitlement: { ...entitlement, windowKey: "2026-12" } };
    assert.equal((await finalize(newWindow, remaining)).status, "FINALIZED");
    assert.equal((await getUsage(context.shop, newWindow.entitlement)).used, 1);
  });
}
