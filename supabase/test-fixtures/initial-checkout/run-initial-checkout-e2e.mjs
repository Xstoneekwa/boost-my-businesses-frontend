#!/usr/bin/env node
/**
 * Initial Checkout API E2E runner — exercises live Next.js routes against nxntngkhkoynljcagmkq.
 * Requires prepare-initial-checkout.sh --apply and start-initial-checkout-next.sh.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.INITIAL_CHECKOUT_API_BASE_URL ?? "http://127.0.0.1:3000";

function fail(message) {
  console.error(`[run-initial-checkout-e2e] FAIL: ${message}`);
  process.exit(1);
}

function loadState() {
  const path = join(ROOT, ".run-state/initial-checkout-latest.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

const SCENARIOS = [
  "wrong_ref_blocks_simulation",
  "missing_confirm_blocks_simulation",
  "non_fictional_email_blocked",
  "payment_probe_blocked",
  "allowlisted_quote_permission",
  "allowlisted_activation_success",
  "idempotent_retry_no_duplicates",
  "success_handoff_login_not_marketing",
  "plan_change_non_regression",
];

async function main() {
  if (process.env.INITIAL_CHECKOUT_DB_TEST_CONFIRM !== "isolated-test-only") {
    fail("Set INITIAL_CHECKOUT_DB_TEST_CONFIRM=isolated-test-only");
  }
  const state = loadState();
  console.log(`[run-initial-checkout-e2e] run=${state.runId} base=${BASE_URL}`);
  for (const scenario of SCENARIOS) {
    console.log(`[run-initial-checkout-e2e] TODO scenario: ${scenario}`);
  }
  fail("Runner skeleton only — execute after GO with live Next.js + isolated DB");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
