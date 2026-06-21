import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const FORM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/instagram-client/change-plan/PlanChangeCheckoutForm.tsx",
);

test("PlanChangeCheckoutForm reuses quote idempotency key on activate", () => {
  const source = readFileSync(FORM_PATH, "utf8");
  assert.match(source, /idempotency_key: quote\.idempotencyKey/);
  assert.doesNotMatch(source, /activateIdempotencyKey/);
});

test("run-ui-api-e2e uses same idempotency key for quote and activate", () => {
  const runnerPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../supabase/test-fixtures/plan-change/ui-api-e2e/run-ui-api-e2e.mjs",
  );
  const source = readFileSync(runnerPath, "utf8");
  assert.match(source, /postActivate\(paymentTokens, paymentQuoteId, paymentQuoteKey\)/);
  assert.match(source, /postActivate\(tokens, upgradeQuoteId, upgradeQuoteKey\)/);
  assert.match(source, /paymentProbeEmail/);
  assert.doesNotMatch(source, /:pro:activate-ok|:pro:activate-blocked/);
});
