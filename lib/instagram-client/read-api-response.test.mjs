import assert from "node:assert/strict";
import test from "node:test";

import {
  clientSafeEmptyBodyMessage,
  clientSafeInvalidBodyMessage,
  parseClientApiResponse,
} from "./read-api-response.ts";

test("parseClientApiResponse returns client-safe message for empty body", async () => {
  const response = new Response("", { status: 500, headers: { "Content-Type": "text/plain" } });
  const payload = await parseClientApiResponse(response, "fr");
  assert.equal(payload.ok, false);
  assert.equal(payload.message, clientSafeEmptyBodyMessage("fr"));
  assert.doesNotMatch(String(payload.message), /JSON\.parse/i);
});

test("parseClientApiResponse returns client-safe message for invalid JSON", async () => {
  const response = new Response("<html>error</html>", { status: 500 });
  const payload = await parseClientApiResponse(response, "fr");
  assert.equal(payload.ok, false);
  assert.equal(payload.message, clientSafeInvalidBodyMessage("fr"));
});

test("parseClientApiResponse parses valid connect envelope", async () => {
  const response = new Response(JSON.stringify({
    ok: true,
    status: "queued",
    message: "Connexion lancée.",
    data: { connectStatus: "queued", request_queued: true },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const payload = await parseClientApiResponse(response, "fr");
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "queued");
});
