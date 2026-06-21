#!/usr/bin/env node
/**
 * Local validation for Initial Checkout harness files (no DB access).
 * Run from repo root:
 *   node supabase/test-fixtures/initial-checkout/validate-harness-local.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(ROOT, "../../..");

function run(label, fn) {
  try {
    fn();
    console.log(`[validate-initial-checkout-harness] PASS: ${label}`);
    return true;
  } catch (error) {
    const err = /** @type {Error} */ (error);
    console.error(`[validate-initial-checkout-harness] FAIL: ${label} — ${err.message}`);
    return false;
  }
}

function bashSyntax(script) {
  execFileSync("bash", ["-n", join(ROOT, script)], { stdio: "pipe" });
}

function runNodeTests() {
  execFileSync(
    "node",
    [
      "--test",
      join(ROOT, "initial-checkout-e2e.test.mjs"),
      join(REPO_ROOT, "lib/commercial/confirm-commercial-payment.test.mjs"),
      join(REPO_ROOT, "lib/commercial/initial-checkout-simulation-guard.test.mjs"),
      join(REPO_ROOT, "lib/commercial/initial-checkout-handoff.test.mjs"),
      join(REPO_ROOT, "lib/commercial/plan-change-quote-activation.test.mjs"),
      join(REPO_ROOT, "lib/commercial/plan-change-checkout-idempotency.test.mjs"),
      join(REPO_ROOT, "lib/commercial/plan-change-activation-guard.test.mjs"),
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
}

const checks = [
  run("node --test initial checkout suites", runNodeTests),
  run("bash -n preflight-initial-checkout.sh", () => bashSyntax("preflight-initial-checkout.sh")),
  run("bash -n prepare-initial-checkout.sh", () => bashSyntax("prepare-initial-checkout.sh")),
  run("bash -n start-initial-checkout-next.sh", () => bashSyntax("start-initial-checkout-next.sh")),
  run("manifest.json readable", () => {
    JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  }),
];

const ok = checks.every(Boolean);
console.log(
  ok
    ? "[validate-initial-checkout-harness] ALL CHECKS PASSED"
    : "[validate-initial-checkout-harness] ONE OR MORE CHECKS FAILED",
);
process.exit(ok ? 0 : 1);
