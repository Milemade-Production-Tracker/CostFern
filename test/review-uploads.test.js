import assert from "node:assert/strict";
import { Buffer, File } from "node:buffer";
import { createHash } from "node:crypto";
import test from "node:test";
import { MAX_QUOTE_BYTES, parseQuotePair } from "../app/models/quotes.server.js";
import { readQuoteUpload } from "../app/services/review-routes.server.js";

const oldQuote = Buffer.from("\ufeffsku,unit_cost,currency\r\nCAFÉ-01,1.00,USD\r\n");
const newQuote = Buffer.from("sku,unit_cost,currency\nCAFÉ-01,1.20,USD\n");

function upload(oldBytes, newBytes, padding = "") {
  const form = new FormData();
  form.set("supplierId", "supplier-fixture");
  form.set("oldQuote", new File([oldBytes], "previous.csv", { type: "text/csv" }));
  form.set("newQuote", new File([newBytes], "current.csv", { type: "text/csv" }));
  if (padding) form.set("padding", padding);
  return new Request("https://example.com/app", { method: "POST", body: form });
}

test("browser multipart quote fields retain the filenames and original source bytes for fingerprints", async () => {
  const request = upload(oldQuote, newQuote);
  assert.match(request.headers.get("content-type"), /^multipart\/form-data; boundary=/u);
  const result = await readQuoteUpload(request);
  assert.deepEqual([result.supplierId, result.oldFilename, result.newFilename], ["supplier-fixture", "previous.csv", "current.csv"]);

  const pair = parseQuotePair(result.oldCsv, result.newCsv, 500);
  assert.deepEqual(pair.oldQuote.rows, [{ sku: "CAFÉ-01", cost: "1.00", line: 2 }]);
  assert.deepEqual(pair.newQuote.rows, [{ sku: "CAFÉ-01", cost: "1.20", line: 2 }]);
  assert.equal(pair.oldQuote.fingerprint, createHash("sha256").update(oldQuote).digest("hex"));
  assert.equal(pair.newQuote.fingerprint, createHash("sha256").update(newQuote).digest("hex"));
});

test("multipart quote uploads reject malformed UTF-8 before parsing", async () => {
  await assert.rejects(readQuoteUpload(upload(oldQuote, Buffer.from([0xff]))), { code: "CSV_ENCODING", status: 400 });
});

test("multipart quote uploads enforce both file and streamed request limits", async () => {
  await assert.rejects(readQuoteUpload(upload(Buffer.alloc(MAX_QUOTE_BYTES + 1), newQuote)), {
    code: "UPLOAD_SIZE", status: 413,
  });

  const atFileLimit = Buffer.alloc(MAX_QUOTE_BYTES);
  const encoded = upload(atFileLimit, atFileLimit, "x".repeat(16 * 1024));
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const next = offset + 64 * 1024;
      controller.enqueue(bytes.subarray(offset, next));
      offset = next;
    },
  });
  const request = new Request(encoded.url, { method: "POST", headers: encoded.headers, body, duplex: "half" });
  assert.equal(request.headers.get("content-length"), null);
  await assert.rejects(readQuoteUpload(request), { code: "FORM_SIZE", status: 413 });
});
