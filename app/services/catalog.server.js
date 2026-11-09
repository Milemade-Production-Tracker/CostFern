const PAGE_LIMIT = 150;
const TIME_LIMIT_MS = 45_000;
const MAX_RETRIES = 2;

export const CATALOG_QUERY = `#graphql
  query CostFernCatalog($after: String) {
    productVariants(first: 100, after: $after) {
      nodes {
        id
        sku
        title
        media(first: 1) {
          nodes {
            preview {
              image { url(transform: { maxWidth: 96 }) altText }
            }
          }
        }
        product {
          title
          featuredMedia {
            preview {
              image { url(transform: { maxWidth: 96 }) altText }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

class CatalogError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
    this.status = status;
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorCode(error) {
  const errors = error?.body?.errors?.graphQLErrors ?? error?.errors;
  return (Array.isArray(errors) ? errors[0]?.extensions?.code : null) ??
    error?.response?.status ?? error?.status;
}

async function fetchPage(admin, after) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await admin.graphql(CATALOG_QUERY, {
        variables: { after },
        tries: 1,
      });
      const result = await response.json();
      if (!response.ok || result.errors?.length) {
        throw Object.assign(new Error("Variant catalog query failed"), {
          status: response.status,
          errors: result.errors,
        });
      }
      return result.data?.productVariants;
    } catch (error) {
      if (error instanceof Response) throw error;
      const code = errorCode(error);
      if (code === "ACCESS_DENIED" || code === 403) {
        throw new CatalogError(
          "catalog_permission",
          "CostFern needs permission to read products. Open the app from Shopify admin to review its permissions.",
          403,
        );
      }
      if ((code === "THROTTLED" || code === 429) && attempt < MAX_RETRIES) {
        await pause(500 * (attempt + 1));
        continue;
      }
      throw new CatalogError(
        "catalog_unavailable",
        "Shopify could not return the variant catalog. Try again in a moment.",
        503,
      );
    }
  }
}

export async function getCatalogSnapshot(admin, session) {
  if (!session?.shop) {
    throw new CatalogError("catalog_permission", "Open CostFern in Shopify admin.", 401);
  }
  const variants = new Map();
  const deadline = Date.now() + TIME_LIMIT_MS;
  let after = null;

  for (let page = 0; page < PAGE_LIMIT && Date.now() < deadline; page++) {
    const result = await fetchPage(admin, after);
    if (!Array.isArray(result?.nodes) || !result.pageInfo) {
      throw new CatalogError(
        "catalog_unavailable",
        "Shopify returned an incomplete variant catalog. Try again in a moment.",
        503,
      );
    }
    for (const variant of result.nodes) {
      const image = variant.media?.nodes?.[0]?.preview?.image ??
        variant.product.featuredMedia?.preview?.image;
      variants.set(variant.id, {
        id: variant.id,
        sku: variant.sku ?? "",
        title: variant.title,
        productTitle: variant.product.title,
        imageUrl: image?.url ?? null,
        imageAlt: image?.altText ?? null,
      });
    }
    if (!result.pageInfo.hasNextPage) return [...variants.values()];
    const cursor = result.pageInfo.endCursor;
    if (!cursor || cursor === after) break;
    after = cursor;
  }

  throw new CatalogError(
    "catalog_incomplete",
    "CostFern could not read the full catalog within the review limit. No partial matches were saved.",
    503,
  );
}
