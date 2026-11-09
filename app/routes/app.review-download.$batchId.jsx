import { authenticate } from "../shopify.server";
import { getApprovedCsv, getAuditCsv, ReviewError } from "../models/review.server.js";
import { getEntitlement } from "../services/entitlements.server.js";

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const kind = new URL(request.url).searchParams.get("kind");
  const audit = kind === "audit";
  if (kind && kind !== "approved" && !audit) {
    return Response.json({ error: "Choose an approved or audit CSV." }, { status: 400 });
  }
  try {
    const csv = audit
      ? await getAuditCsv(session.shop, params.batchId, await getEntitlement({ admin, session }))
      : await getApprovedCsv(session.shop, params.batchId);
    const id = params.batchId.replace(/[^a-zA-Z0-9-]/g, "");
    const filename = "costfern-" + (audit ? "audit-" : "approved-") + id + ".csv";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="' + filename + '"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
  }
}
