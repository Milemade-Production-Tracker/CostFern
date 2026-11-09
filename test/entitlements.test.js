import test from "node:test";
import assert from "node:assert/strict";
import { getEntitlement, getPricingUrl } from "../app/services/entitlements.server.js";

const SHOP = "costfern-fixtures.myshopify.com";
const SHOP_ID = "gid://shopify/Shop/100";
const APP_ID = "gid://shopify/App/200";
const SESSION_ID = "offline_costfern-fixtures.myshopify.com";
const NOW = new Date("2026-02-28T16:00:00.000Z");
const ENV = {
  NODE_ENV: "production",
  SHOPIFY_PARTNER_ORG_ID: "300",
  SHOPIFY_PARTNER_API_ACCESS_TOKEN: "fixture-token",
  SHOPIFY_APP_GID: APP_ID,
  SHOPIFY_API_KEY: "fixture-key",
  SHOPIFY_APP_HANDLE: "cost-fern",
};

function contract(id, billingPeriod = "EVERY_30_DAYS") {
  return {
    app: { id: APP_ID, apiKey: ENV.SHOPIFY_API_KEY },
    shop: { id: SHOP_ID },
    billingPeriod,
    cancelAtEndOfCycle: false,
    trialEndsAt: null,
    currentBillingCycle: { startTime: "2026-02-01T00:00:00Z", endTime: "2026-04-01T00:00:00Z" },
    items: [{ handle: id, price: { __typename: "FlatRatePrice" } }],
  };
}

function privateTestContract({ amount = "0.00", currency = "USD", period = "EVERY_30_DAYS" } = {}) {
  return {
    ...contract("shopify-test", period),
    items: [{ handle: "shopify-test", price: { __typename: "FlatRatePrice", amount, currency } }],
  };
}

function fixture({ active = contract("starter"), environment = ENV, partnerDevelopment = true, adminShop = SHOP,
  history, anchor = new Date("2026-01-31T15:00:00.000Z"), requestError = false } = {}) {
  const calls = [];
  let stored = anchor ? { shop: SHOP, anchorAt: anchor } : null;
  const session = { shop: SHOP, id: SESSION_ID };
  const admin = { graphql: async (_query, { variables }) => {
    calls.push(variables.checkDevelopment ? "dev-shop" : "shop");
    return Response.json({ data: { shop: { id: SHOP_ID, myshopifyDomain: adminShop, plan: { partnerDevelopment } } } });
  } };
  const options = {
    env: environment,
    request: async (url, { body, headers }) => {
      assert.equal(url, "https://partners.shopify.com/300/api/2026-07/graphql.json");
      assert.equal(headers["X-Shopify-Access-Token"], ENV.SHOPIFY_PARTNER_API_ACCESS_TOKEN);
      const { query, variables } = JSON.parse(body);
      if (query.includes("CostFernSubscriptionStart")) {
        assert.equal(variables.filter.shopId, SHOP_ID);
        assert.equal(variables.filter.subjectId, APP_ID);
        calls.push("history");
        const edges = history ? [{ node: history }] : [];
        return Response.json({ data: { events: { edges } } });
      }
      assert.deepEqual(variables, { appId: APP_ID, shopId: SHOP_ID });
      calls.push("active");
      if (requestError) return Response.json({ errors: [{ message: "Throttled" }] }, { status: 429 });
      return Response.json({ data: { activeSubscription: active } });
    },
    anchors: { findUnique: async ({ where }) => {
      assert.deepEqual(where, { shop: SHOP });
      return stored;
    } },
    write: async (shop, id, operation) => {
      assert.equal(shop, SHOP);
      assert.equal(id, SESSION_ID);
      calls.push("save-anchor");
      return operation({ entitlementAnchor: { upsert: async ({ create }) => {
        stored ??= create;
        return stored;
      } } });
    },
  };
  return { calls, resolve: (now = NOW) => getEntitlement({ session, admin }, { ...options, now }) };
}

test("maps all five recurring choices to the three configured tier limits", async () => {
  for (const [id, interval, batches, rows, compare, audit] of [
    ["starter", "EVERY_30_DAYS", 10, 500, false, false],
    ["growth", "EVERY_30_DAYS", 50, 2_000, true, false],
    ["growth", "ANNUAL", 50, 2_000, true, false],
    ["pro", "EVERY_30_DAYS", 150, 5_000, true, true],
    ["pro", "ANNUAL", 150, 5_000, true, true],
  ]) {
    const entitlement = await fixture({ active: contract(id, interval) }).resolve();
    assert.deepEqual([
      entitlement.status, entitlement.id, entitlement.billingPeriod, entitlement.maxBatches,
      entitlement.maxRows, entitlement.canCompare, entitlement.canAudit,
    ], ["active", id, interval, batches, rows, compare, audit]);
  }
});

test("trial uses the original effective date and short month restores the original day next month", async () => {
  const active = {
    ...contract("starter"),
    trialEndsAt: "2026-02-03T15:00:00Z",
    currentBillingCycle: null,
  };
  const merchant = fixture({ active, anchor: null, history: {
    occurredAt: "2026-01-31T15:00:00Z", plan: { handle: "starter" },
  } });
  const trial = await merchant.resolve(new Date("2026-02-01T00:00:00Z"));
  assert.equal(trial.status, "trial");
  assert.equal(trial.windowKey, "2026-01");
  assert.equal(trial.windowEndsAt, "2026-02-28T15:00:00.000Z");
  Object.assign(active, contract("growth", "ANNUAL"));
  const paid = await merchant.resolve(new Date("2026-02-28T14:59:59Z"));
  assert.equal(paid.id, "growth");
  assert.equal(paid.windowKey, trial.windowKey);
  const renewed = await merchant.resolve();
  assert.equal(renewed.windowKey, "2026-02");
  assert.equal(renewed.windowEndsAt, "2026-03-31T15:00:00.000Z");
  assert.deepEqual(merchant.calls, ["shop", "active", "history", "save-anchor", "shop", "active", "shop", "active"]);
});

test("scheduled cancellation and pending downgrade preserve current access until it ends", async () => {
  const active = { ...contract("pro"), cancelAtEndOfCycle: true, pendingUpdate: contract("starter") };
  const merchant = fixture({ active });
  const live = await merchant.resolve();
  assert.equal(live.id, "pro");
  assert.equal(live.accessEndsAt, "2026-04-01T00:00:00.000Z");
  const expired = await merchant.resolve(new Date(live.accessEndsAt));
  assert.equal(expired.id, null);
  assert.equal(expired.canAudit, false);
});

test("missing, unexpected, mismatched and failed subscription lookups fail closed", async () => {
  for (const [input, status] of [
    [{ active: null }, "unsubscribed"],
    [{ active: contract("unknown") }, "unknown_plan"],
    [{ active: contract("starter", "ANNUAL") }, "unknown_plan"],
    [{ active: { ...contract("pro"), shop: { id: "gid://shopify/Shop/999" } } }, "unavailable"],
    [{ active: { ...contract("pro"), app: { id: APP_ID, apiKey: "different-app" } } }, "unavailable"],
    [{ requestError: true }, "unavailable"],
    [{ adminShop: "different.myshopify.com" }, "unavailable"],
  ]) {
    const entitlement = await fixture(input).resolve();
    assert.equal(entitlement.status, status);
    assert.equal(entitlement.id, null);
    assert.equal(entitlement.maxBatches, 0);
  }
});

test("development override needs exact allowed shop, development runtime, and platform dev flag", async () => {
  const environment = { NODE_ENV: "development", COSTFERN_DEV_SHOP: SHOP, COSTFERN_DEV_TIER: "pro" };
  const allowed = fixture({ environment });
  const simulated = await allowed.resolve();
  assert.equal(simulated.developmentOverride, true);
  assert.equal(simulated.id, "pro");
  assert.equal(simulated.windowKey, "dev:2026-02");
  assert.deepEqual(allowed.calls, ["dev-shop"]);

  for (const input of [
    { environment: { ...environment, NODE_ENV: "production" } },
    { environment: { ...environment, COSTFERN_DEV_SHOP: "other.myshopify.com" } },
    { environment, partnerDevelopment: false },
  ]) {
    assert.equal((await fixture(input).resolve()).id, null);
  }

  const production = fixture({ environment: { ...environment, ...ENV } });
  assert.equal((await production.resolve()).id, "starter");
  assert.deepEqual(production.calls, ["shop", "active"]);
});

test("Shopify's verified private zero-dollar contract grants Starter without enabling the simulator", async () => {
  const environment = { ...ENV, NODE_ENV: "development", COSTFERN_PRICING_TEST_SHOP: SHOP, COSTFERN_DEV_TIER: "pro" };
  const merchant = fixture({ active: privateTestContract(), environment, anchor: null, history: {
    occurredAt: "2026-01-31T15:00:00.000Z", plan: { handle: "shopify-test" },
  } });
  const entitlement = await merchant.resolve();
  assert.deepEqual([entitlement.id, entitlement.status, entitlement.planHandle, entitlement.developmentOverride,
    entitlement.maxBatches, entitlement.maxRows, entitlement.windowKey, entitlement.windowEndsAt],
  ["starter", "active", "shopify-test", false, 10, 500, "2026-02", "2026-03-31T15:00:00.000Z"]);
  assert.deepEqual(merchant.calls, ["dev-shop", "active", "history", "save-anchor"]);
});

test("the private handle fails closed outside the designated verified development shop or exact zero-dollar contract", async () => {
  const active = privateTestContract();
  const environment = { ...ENV, COSTFERN_PRICING_TEST_SHOP: SHOP };
  for (const input of [
    { active, environment: ENV },
    { active, environment: { ...environment, COSTFERN_PRICING_TEST_SHOP: "different.myshopify.com" } },
    { active, environment: { ...environment, COSTFERN_STARTER_HANDLE: "shopify-test" } },
    { active, environment, partnerDevelopment: false },
    { active: privateTestContract({ amount: "0.01" }), environment },
    { active: privateTestContract({ currency: "EUR" }), environment },
    { active: privateTestContract({ period: "ANNUAL" }), environment },
    { active: contract("shopify-test"), environment },
    { active: { ...active, items: [...active.items, { handle: "meter", price: { __typename: "TieredPrice" } }] }, environment },
    { active: { ...active, trialEndsAt: "2026-03-01T00:00:00Z", currentBillingCycle: null }, environment },
  ]) {
    const entitlement = await fixture(input).resolve();
    assert.equal(entitlement.id, null);
    assert.equal(entitlement.maxBatches, 0);
  }
});

test("canonical Starter still resolves with a designated test shop and ignores unverified private history", async () => {
  const active = contract("starter");
  active.items[0].price = { __typename: "FlatRatePrice", amount: "0.00", currency: "USD" };
  const environment = { ...ENV, COSTFERN_PRICING_TEST_SHOP: SHOP };
  const merchant = fixture({ active, environment, partnerDevelopment: false, anchor: null, history: {
    occurredAt: "2026-01-31T15:00:00.000Z", plan: { handle: "shopify-test" },
  } });
  const entitlement = await merchant.resolve();
  assert.equal(entitlement.id, "starter");
  assert.equal(entitlement.status, "active");
  assert.equal(entitlement.planHandle, "starter");
  assert.equal(entitlement.windowEndsAt, "2026-03-01T00:00:00.000Z");
  assert.deepEqual(merchant.calls, ["dev-shop", "active", "history", "save-anchor"]);
});

test("plan selection links use an authenticated shop slug and a configured app handle", () => {
  assert.equal(getPricingUrl(SHOP, ENV), "https://admin.shopify.com/store/costfern-fixtures/charges/cost-fern/pricing_plans");
  assert.equal(getPricingUrl("https://example.com", ENV), null);
  assert.equal(getPricingUrl(SHOP, { SHOPIFY_APP_HANDLE: "../bad" }), null);
});
