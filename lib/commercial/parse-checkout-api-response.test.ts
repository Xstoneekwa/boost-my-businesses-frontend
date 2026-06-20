import assert from "node:assert/strict";
import test from "node:test";

import { CHECKOUT_UNAVAILABLE_FR } from "./checkout-api-messages.ts";
import { parseCheckoutApiResponse } from "./parse-checkout-api-response.ts";

function mockResponse(input: {
  status?: number;
  contentType?: string;
  body: string;
}) {
  return new Response(input.body, {
    status: input.status ?? 200,
    headers: input.contentType ? { "content-type": input.contentType } : undefined,
  });
}

test("parseCheckoutApiResponse parses valid JSON success", async () => {
  const parsed = await parseCheckoutApiResponse<{ quote?: { totalPeriodCents: number } }>(
    mockResponse({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { quote: { totalPeriodCents: 19700 } } }),
    }),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.parseError, false);
  assert.equal(parsed.data?.quote?.totalPeriodCents, 19700);
});

test("parseCheckoutApiResponse handles empty body safely", async () => {
  const parsed = await parseCheckoutApiResponse(mockResponse({ status: 500, body: "" }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.parseError, true);
  assert.match(parsed.clientMessageFr, /temporairement indisponible/i);
});

test("parseCheckoutApiResponse handles HTML safely", async () => {
  const parsed = await parseCheckoutApiResponse(
    mockResponse({ status: 500, contentType: "text/html", body: "<html><body>Error</body></html>" }),
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.parseError, true);
  assert.equal(parsed.clientMessageFr, CHECKOUT_UNAVAILABLE_FR);
});

test("parseCheckoutApiResponse uses server message_fr on 403 JSON", async () => {
  const parsed = await parseCheckoutApiResponse(
    mockResponse({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "simulated_checkout_email_not_allowlisted",
        message_fr: "L'activation de test n'est pas disponible pour cette adresse e-mail.",
        message_en: "Test activation is not available for this email address.",
      }),
    }),
  );
  assert.equal(parsed.ok, false);
  assert.match(parsed.clientMessageFr, /adresse e-mail/i);
});
