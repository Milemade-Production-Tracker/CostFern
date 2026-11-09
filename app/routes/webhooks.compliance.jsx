import { authenticate } from "../shopify.server";
import { redactShop, webhookTimestamp } from "../services/lifecycle.server";

export async function action({ request }) {
  const { topic, payload, shop } = await authenticate.webhook(request);
  if (payload.shop_domain !== shop) {
    return new Response(null, { status: 400 });
  }

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // CostFern stores supplier quote data and staff decisions, without customer records.
      return new Response();
    case "SHOP_REDACT":
      await redactShop(shop, webhookTimestamp(request));
      return new Response();
    default:
      return new Response(null, { status: 400 });
  }
}
