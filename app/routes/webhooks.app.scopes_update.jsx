import { authenticate } from "../shopify.server";
import { syncSessionScopes, webhookTimestamp } from "../services/lifecycle.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  if (topic !== "APP_SCOPES_UPDATE" || !Array.isArray(payload.current)) {
    return new Response(null, { status: 400 });
  }

  await syncSessionScopes(shop, webhookTimestamp(request), payload.current);
  return new Response();
};
