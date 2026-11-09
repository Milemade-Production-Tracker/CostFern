import { Buffer } from "node:buffer";
import { data } from "react-router";
import { ReviewError } from "../models/review.server.js";
import { MAX_QUOTE_BYTES } from "../models/quotes.server.js";

export function reviewActionError(error) {
  if (error instanceof ReviewError || isCatalogError(error)) {
    return data({ error: error.message, code: error.code }, { status: error.status });
  }
  throw error;
}

export function isCatalogError(error) {
  return ["catalog_permission", "catalog_unavailable", "catalog_incomplete"].includes(error?.code);
}

export function reviewActor({ session, sessionToken }) {
  const actor = sessionToken?.sub ?? session.onlineAccessInfo?.associated_user?.id;
  if (!actor) {
    throw new ReviewError("ACTOR_REQUIRED", "Reopen CostFern in Shopify admin to verify your reviewer identity.", 403);
  }
  return String(actor);
}

async function boundedForm(request, maxBytes, sizeMessage, formatMessage) {
  if (!request.body || Number(request.headers.get("content-length")) > maxBytes) {
    throw new ReviewError("FORM_SIZE", sizeMessage, 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw new ReviewError("FORM_SIZE", sizeMessage, 413);
    }
    chunks.push(chunk);
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new ReviewError("FORM_FORMAT", formatMessage, 400);
  }
}

export function readReviewForm(request) {
  return boundedForm(request, 16 * 1024, "This form is too large. Shorten your input and try again.", "The form could not be read. Try again.");
}

export async function readQuoteUpload(request) {
  const form = await boundedForm(
    request, 2 * MAX_QUOTE_BYTES + 16 * 1024, "Each quote file must be 2 MB or smaller.",
    "The upload could not be read. Select both CSV files and try again.",
  );
  const supplierId = String(form.get("supplierId") ?? "");
  if (!supplierId) {
    throw new ReviewError("SUPPLIER_REQUIRED", "Select a supplier for these quotes.", 400);
  }
  const oldFile = form.get("oldQuote");
  const newFile = form.get("newQuote");
  const [oldCsv, newCsv] = await Promise.all([readQuote(oldFile), readQuote(newFile)]);
  return { supplierId, oldCsv, newCsv, oldFilename: oldFile.name, newFilename: newFile.name };
}

async function readQuote(file) {
  if (!file || typeof file === "string" || !file.size) {
    throw new ReviewError("FILE_REQUIRED", "Select a non-empty CSV for each quote.", 400);
  }
  if (file.size > MAX_QUOTE_BYTES) {
    throw new ReviewError("UPLOAD_SIZE", "Each quote file must be 2 MB or smaller.", 413);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
  } catch {
    throw new ReviewError("CSV_ENCODING", "Save both quote files as UTF-8 CSV and try again.", 400);
  }
}
