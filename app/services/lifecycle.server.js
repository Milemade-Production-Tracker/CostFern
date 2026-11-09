import db from "../db.server.js";

export function webhookTimestamp(request) {
  const timestamp = Date.parse(request.headers.get("x-shopify-triggered-at") ?? "");
  if (!Number.isFinite(timestamp)) {
    throw new Response("Invalid webhook timestamp", { status: 400 });
  }
  return new Date(timestamp);
}

function withShopLock(shop, operation) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT true FROM pg_advisory_xact_lock(hashtextextended(${shop}, 0::bigint))`;
    return operation(tx);
  });
}

export function removeUninstalledSessions(shop, triggeredAt) {
  return withShopLock(shop, (tx) =>
    tx.session.deleteMany({ where: { shop, createdAt: { lte: triggeredAt } } }),
  );
}

export function syncSessionScopes(shop, triggeredAt, scopes) {
  return withShopLock(shop, (tx) =>
    tx.session.updateMany({
      where: {
        shop,
        createdAt: { lte: triggeredAt },
        OR: [{ scopeUpdatedAt: null }, { scopeUpdatedAt: { lt: triggeredAt } }],
      },
      data: { scope: scopes.join(","), scopeUpdatedAt: triggeredAt },
    }),
  );
}

export function redactShop(shop, triggeredAt) {
  return withShopLock(shop, async (tx) => {
    const reinstalled = await tx.session.findFirst({
      where: { shop, createdAt: { gt: triggeredAt } },
      select: { id: true },
    });
    if (reinstalled) return;

    await tx.supplier.deleteMany({ where: { shop } });
    await tx.reviewUsage.deleteMany({ where: { shop } });
    await tx.entitlementAnchor.deleteMany({ where: { shop } });
    await tx.session.deleteMany({ where: { shop } });
  });
}
