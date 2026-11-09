import prisma from "../db.server.js";
import { withShopWrite } from "../models/quotes.server.js";

const PARTNER_API_VERSION = "2026-07";
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const PLAN_HANDLE = /^[a-z0-9][a-z0-9_-]*$/;
const PRIVATE_TEST_HANDLE = "shopify-test";
const DAY_MS = 86_400_000;

export const plans = Object.freeze({
  starter: { id: "starter", name: "Starter", monthly: 39, yearly: null, maxBatches: 10, maxRows: 500, canCompare: false, canAudit: false },
  growth: { id: "growth", name: "Growth", monthly: 79, yearly: 790, maxBatches: 50, maxRows: 2_000, canCompare: true, canAudit: false },
  pro: { id: "pro", name: "Pro", monthly: 129, yearly: 1_290, maxBatches: 150, maxRows: 5_000, canCompare: true, canAudit: true },
});

const SHOP_QUERY = `#graphql
  query CostFernBillingShop($checkDevelopment: Boolean!) {
    shop {
      id
      myshopifyDomain
      plan @include(if: $checkDevelopment) { partnerDevelopment }
    }
  }
`;

const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query CostFernActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      app { id apiKey }
      shop { id }
      billingPeriod
      cancelAtEndOfCycle
      trialEndsAt
      currentBillingCycle { startTime endTime }
      items {
        handle
        price {
          __typename
          currency
          ... on FlatRatePrice { amount }
        }
      }
    }
  }
`;

const SUBSCRIPTION_START_QUERY = `#graphql
  query CostFernSubscriptionStart($filter: EventFilterInput) {
    events(filter: $filter, orderBy: OCCURRED_AT_ASC, first: 20) {
      edges {
        node {
          occurredAt
          ... on SubscriptionStatus { plan { handle } }
        }
      }
    }
  }
`;

function configuredHandles(env) {
  return new Map(Object.keys(plans).map((id) => [env[`COSTFERN_${id.toUpperCase()}_HANDLE`] || id, id]));
}

function billingWindow(anchor, now) {
  function boundary(offset) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + offset;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
  }

  const offset = now < boundary(0) ? -1 : 0;
  return {
    windowKey: boundary(offset).toISOString().slice(0, 7),
    windowEndsAt: boundary(offset + 1).toISOString(),
  };
}

function result(status, now, { id = null, anchor = now, ...details } = {}) {
  const plan = id ? plans[id] : null;
  return {
    status,
    id,
    planName: plan?.name ?? null,
    maxBatches: plan?.maxBatches ?? 0,
    maxRows: plan?.maxRows ?? 0,
    canCompare: plan?.canCompare ?? false,
    canAudit: plan?.canAudit ?? false,
    developmentOverride: status === "development",
    ...billingWindow(anchor, now),
    ...details,
  };
}

export function getPricingUrl(shop, env = process.env) {
  const handle = env.SHOPIFY_APP_HANDLE;
  if (!SHOP_DOMAIN.test(shop) || !handle || !PLAN_HANDLE.test(handle)) return null;
  const store = shop.slice(0, -".myshopify.com".length);
  return `https://admin.shopify.com/store/${store}/charges/${handle}/pricing_plans`;
}

async function readGraphql(response) {
  if (!response.ok) throw new Error("Shopify GraphQL request failed.");
  const body = await response.json();
  if (body.errors?.length || !body.data) throw new Error("Shopify GraphQL response was incomplete.");
  return body.data;
}

function validDate(value) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

async function partnerQuery(config, query, variables, request) {
  return readGraphql(await request(`https://partners.shopify.com/${config.organization}/api/${PARTNER_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.token,
    },
    body: JSON.stringify({ query, variables }),
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  }));
}

async function firstSubscriptionStart(config, shopId, handles, now, request) {
  const data = await partnerQuery(config, SUBSCRIPTION_START_QUERY, { filter: {
    shopId,
    subjectId: config.appId,
    eventTypes: ["SUBSCRIPTION_CREATED"],
    occurredAtMin: new Date(now.getTime() - 365 * DAY_MS).toISOString(),
    occurredAtMax: now.toISOString(),
  } }, request);

  const event = data.events?.edges.find(({ node }) => handles.has(node.plan?.handle));
  return validDate(event?.node.occurredAt);
}

export async function getEntitlement({ admin, session }, {
  env = process.env,
  request = fetch,
  now = new Date(),
  anchors = prisma.entitlementAnchor,
  write = withShopWrite,
} = {}) {
  const shop = session?.shop;
  if (!session?.id || !SHOP_DOMAIN.test(shop) || !admin?.graphql) return result("unavailable", now);

  const testTier = env.COSTFERN_DEV_TIER;
  const simulate = env.NODE_ENV === "development" &&
    env.COSTFERN_DEV_SHOP === shop && Object.hasOwn(plans, testTier);
  const checkPricingTest = env.COSTFERN_PRICING_TEST_SHOP === shop;
  const checkDevelopment = simulate || checkPricingTest;

  const config = {
    organization: env.SHOPIFY_PARTNER_ORG_ID,
    token: env.SHOPIFY_PARTNER_API_ACCESS_TOKEN,
    appId: env.SHOPIFY_APP_GID,
    apiKey: env.SHOPIFY_API_KEY,
  };
  const handles = configuredHandles(env);
  const partnerConfigured = /^\d+$/.test(config.organization) && config.token &&
    /^gid:\/\/shopify\/App\/\d+$/.test(config.appId) && config.apiKey &&
    handles.size === Object.keys(plans).length &&
    [...handles.keys()].every((handle) => handle !== PRIVATE_TEST_HANDLE && PLAN_HANDLE.test(handle));
  if (!simulate && !partnerConfigured) return result("unavailable", now);

  try {
    const { shop: verifiedShop } = await readGraphql(await admin.graphql(SHOP_QUERY, { variables: { checkDevelopment } }));
    if (verifiedShop?.myshopifyDomain !== shop || !/^gid:\/\/shopify\/Shop\/\d+$/.test(verifiedShop.id)) {
      return result("unavailable", now);
    }

    if (simulate && verifiedShop.plan?.partnerDevelopment === true) {
      return result("development", now, {
        id: testTier,
        anchor: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        windowKey: `dev:${now.toISOString().slice(0, 7)}`,
      });
    }
    if (!partnerConfigured) return result("unavailable", now);

    const { activeSubscription: active } = await partnerQuery(config, ACTIVE_SUBSCRIPTION_QUERY, {
      appId: config.appId,
      shopId: verifiedShop.id,
    }, request);
    if (active === null) return result("unsubscribed", now);
    if (active?.app?.id !== config.appId || active.app.apiKey !== config.apiKey || active.shop?.id !== verifiedShop.id) {
      return result("unavailable", now);
    }

    const recurring = active.items?.filter(({ price }) => price?.__typename === "FlatRatePrice");
    const item = recurring?.length === 1 ? recurring[0] : null;
    const billingPeriod = active.billingPeriod;
    const isPrivateTest = item?.handle === PRIVATE_TEST_HANDLE && checkPricingTest &&
      verifiedShop.plan?.partnerDevelopment === true && active.items.length === 1 &&
      billingPeriod === "EVERY_30_DAYS" && item.price.currency === "USD" &&
      typeof item.price.amount === "string" && /^0(?:\.0+)?$/u.test(item.price.amount);
    const id = isPrivateTest ? "starter" : handles.get(item?.handle);
    if (!id || (billingPeriod !== "EVERY_30_DAYS" && (billingPeriod !== "ANNUAL" || id === "starter"))) {
      return result("unknown_plan", now);
    }

    const trialEnd = validDate(active.trialEndsAt);
    const start = validDate(active.currentBillingCycle?.startTime);
    const end = validDate(active.currentBillingCycle?.endTime);
    const isTrial = id === "starter" && !isPrivateTest && trialEnd > now && active.currentBillingCycle === null;
    const isPaid = active.trialEndsAt === null && start && end && start <= now && now < end;
    if (!isTrial && !isPaid) return result("unavailable", now);

    let stored = await anchors.findUnique({ where: { shop } });
    if (!stored) {
      const anchorHandles = isPrivateTest ? new Map(handles).set(PRIVATE_TEST_HANDLE, id) : handles;
      const firstStart = await firstSubscriptionStart(config, verifiedShop.id, anchorHandles, now, request);
      const anchorAt = firstStart && firstStart <= now ? firstStart : (start ?? now);
      stored = await write(shop, session.id, (tx) => tx.entitlementAnchor.upsert({
        where: { shop },
        create: { shop, anchorAt },
        update: {},
      }));
    }
    const windowTime = stored.anchorAt > now ? stored.anchorAt : now;
    return result(isTrial ? "trial" : "active", windowTime, {
      id,
      anchor: stored.anchorAt,
      planHandle: item.handle,
      billingPeriod,
      trialEndsAt: trialEnd?.toISOString() ?? null,
      accessEndsAt: active.cancelAtEndOfCycle ? (trialEnd ?? end).toISOString() : null,
    });
  } catch {
    return result("unavailable", now);
  }
}
