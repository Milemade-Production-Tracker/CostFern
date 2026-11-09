import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import test from "node:test";

const testUrl = process.env.COSTFERN_TEST_DATABASE_URL;

test("Shopify lifecycle events stay in the right shop and installation", { skip: !testUrl }, async () => {
  const target = new URL(testUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      target.pathname !== "/costfern_test") {
    throw new Error("Lifecycle tests require the isolated local costfern_test database.");
  }
  process.env.DATABASE_URL = testUrl;
  const { default: db } = await import("../app/db.server.js");
  const { removeUninstalledSessions, syncSessionScopes, redactShop } =
    await import("../app/services/lifecycle.server.js");
  const { withShopWrite } = await import("../app/models/quotes.server.js");

  const suffix = randomUUID();
  const shop = `costfern-lifecycle-${suffix}.myshopify.com`;
  const otherShop = `costfern-other-${suffix}.myshopify.com`;
  const earlier = new Date("2026-11-01T00:00:00Z");
  const beforeReinstall = new Date("2026-11-04T00:00:00Z");
  const reinstalledAt = new Date("2026-11-05T00:00:00Z");
  const afterward = new Date("2026-11-06T00:00:00Z");
  const oldSession = `old-${suffix}`;
  const newSession = `new-${suffix}`;
  const session = (id, tenant, createdAt) =>
    ({ id, shop: tenant, createdAt, scope: "read_products", state: "test", accessToken: "test-token" });

  try {
    await db.session.createMany({ data: [
      session(oldSession, shop, earlier),
      session(newSession, shop, reinstalledAt),
      session(`other-${suffix}`, otherShop, earlier),
    ] });
    for (const tenant of [shop, otherShop]) {
      await db.supplier.create({ data: { shop: tenant, name: "Test supplier", code: "QA", currency: "USD" } });
      await db.entitlementAnchor.create({ data: { shop: tenant, anchorAt: earlier } });
      await db.reviewUsage.create({ data: { shop: tenant, windowKey: "2026-11", used: 1 } });
    }

    await syncSessionScopes(shop, beforeReinstall, []);
    await syncSessionScopes(shop, earlier, ["read_products"]);
    assert.equal((await db.session.findUnique({ where: { id: oldSession } })).scope, "");
    assert.equal((await db.session.findUnique({ where: { id: newSession } })).scope, "read_products");

    await removeUninstalledSessions(shop, beforeReinstall);
    assert.equal(await db.session.count({ where: { shop } }), 1);
    await redactShop(shop, beforeReinstall);
    assert.equal(await db.supplier.count({ where: { shop } }), 1);
    await redactShop(shop, afterward);
    await redactShop(shop, afterward);
    assert.equal(await db.session.count({ where: { shop } }), 0);
    assert.equal(await db.supplier.count({ where: { shop } }), 0);
    assert.equal(await db.entitlementAnchor.count({ where: { shop } }), 0);
    assert.equal(await db.reviewUsage.count({ where: { shop } }), 0);
    assert.equal(await db.supplier.count({ where: { shop: otherShop } }), 1);
    await assert.rejects(withShopWrite(shop, newSession, () => {
      assert.fail("A stale authenticated request must not recreate erased data.");
    }));
  } finally {
    await redactShop(shop, afterward);
    await redactShop(otherShop, afterward);
    await db.$disconnect();
  }
});
