import { authenticate } from "../shopify.server";
import { removeUninstalledSessions, webhookTimestamp } from "../services/lifecycle.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  if (topic !== "APP_UNINSTALLED" ||
      (payload.myshopify_domain && payload.myshopify_domain !== shop)) {
    return new Response(null, { status: 400 });
  }

  await removeUninstalledSessions(shop, webhookTimestamp(request));
  return new Response();
};
