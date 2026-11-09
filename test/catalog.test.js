import assert from "node:assert/strict";
import test from "node:test";
import { getCatalogSnapshot } from "../app/services/catalog.server.js";

const session = { shop: "fixture.myshopify.com" };

function variant(id, sku, imageUrl) {
  return {
    id,
    sku,
    title: "Large",
    product: {
      title: "Sample product",
      featuredMedia: imageUrl ? { preview: { image: { url: imageUrl, altText: "Sample" } } } : null,
    },
  };
}

function page(nodes, endCursor) {
  return Response.json({
    data: {
      productVariants: { nodes, pageInfo: { hasNextPage: Boolean(endCursor), endCursor } },
    },
  });
}

test("reads all catalog pages and preserves separate variants with duplicate or empty SKUs", async () => {
  const imageUrl = "https://cdn.shopify.com/sample.png";
  const cursors = [];
  const admin = {
    graphql: async (_, { variables: { after } }) => {
      cursors.push(after);
      return after === null
        ? page([variant("variant-1", "SAME", imageUrl)], "next")
        : page([variant("variant-2", "SAME"), variant("variant-3", null)]);
    },
  };
  const catalog = await getCatalogSnapshot(admin, session);
  assert.deepEqual(cursors, [null, "next"]);
  assert.deepEqual(catalog.map(({ id, sku }) => [id, sku]), [
    ["variant-1", "SAME"], ["variant-2", "SAME"], ["variant-3", ""],
  ]);
  assert.equal(catalog[0].imageUrl, imageUrl);
  assert.equal(catalog[1].imageUrl, null);
});

test("distinguishes permission denial and rejects a partial catalog with an invalid cursor", async () => {
  await assert.rejects(
    getCatalogSnapshot({
      graphql: async () => Response.json({ errors: [{ extensions: { code: "ACCESS_DENIED" } }] }),
    }, session),
    { code: "catalog_permission", status: 403 },
  );
  await assert.rejects(
    getCatalogSnapshot({
      graphql: async () => page([variant("variant-1", "SAME")], "repeated"),
    }, session),
    { code: "catalog_incomplete" },
  );
});
