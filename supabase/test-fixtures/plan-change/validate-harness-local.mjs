#!/usr/bin/env node
/**
 * Local validation for untracked Plan Change harness files (no DB access).
 * Run from repo root:
 *   node supabase/test-fixtures/plan-change/validate-harness-local.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_SQL_FILES, validateAuditSqlContent } from "./validate-audit-sql.mjs";
import { validateManifestSchema } from "./harness-manifest-contract.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(ROOT, "../../..");

function run(label, fn) {
  try {
    fn();
    console.log(`[validate-harness-local] PASS: ${label}`);
    return true;
  } catch (error) {
    const err = /** @type {Error} */ (error);
    console.error(`[validate-harness-local] FAIL: ${label} — ${err.message}`);
    return false;
  }
}

function bashSyntax(script) {
  execFileSync("bash", ["-n", join(ROOT, script)], { stdio: "pipe" });
}

function validateManifestJson() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const errors = validateManifestSchema(manifest);
  if (errors.length) {
    throw new Error(errors.join("; "));
  }
}

function checkWhitespace() {
  const files = readdirSync(ROOT, { recursive: true })
    .map((f) => String(f).replace(/\\/g, "/"))
    .filter((f) => /\.(mjs|json|sh|sql|md)$/.test(f) || f.endsWith(".gitignore"));
  for (const rel of files) {
    const content = readFileSync(join(ROOT, rel), "utf8");
    for (const [i, line] of content.split("\n").entries()) {
      if (/[ \t]+$/.test(line)) {
        throw new Error(`trailing whitespace in ${rel}:${i + 1}`);
      }
    }
  }
}

function runNodeTests() {
  execFileSync(
    "node",
    [
      "--test",
      join(REPO_ROOT, "scripts/plan-change-rest-probe.test.mjs"),
      ...readdirSync(ROOT)
        .filter((f) => f.endsWith(".test.mjs"))
        .map((f) => join(ROOT, f)),
      join(ROOT, "fast-track/apply-fast-track-plan-change.test.mjs"),
      join(ROOT, "ui-api-e2e/ui-api-e2e.test.mjs"),
      join(REPO_ROOT, "lib/commercial/plan-change-source-revision.test.mjs"),
      join(REPO_ROOT, "lib/commercial/plan-change-quote-activation.test.mjs"),
      join(REPO_ROOT, "lib/commercial/plan-change-checkout-idempotency.test.mjs"),
    ],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
}

function validateAuditSqlFiles() {
  for (const file of AUDIT_SQL_FILES) {
    validateAuditSqlContent(readFileSync(join(ROOT, file), "utf8"), file);
  }
}

const checks = [
  run("node --test harness suites", runNodeTests),
  run("bash -n apply-plan-change-test-harness.sh", () => bashSyntax("apply-plan-change-test-harness.sh")),
  run("bash -n fast-track/apply-fast-track-plan-change.sh", () =>
    bashSyntax("fast-track/apply-fast-track-plan-change.sh")
  ),
  run("bash -n ui-api-e2e/preflight-ui-api-e2e.sh", () =>
    bashSyntax("ui-api-e2e/preflight-ui-api-e2e.sh")
  ),
  run("bash -n ui-api-e2e/apply-ui-api-e2e.sh", () => bashSyntax("ui-api-e2e/apply-ui-api-e2e.sh")),
  run("bash -n audit-reference-schema.sh", () => bashSyntax("audit-reference-schema.sh")),
  run("bash -n audit-test-target.sh", () => bashSyntax("audit-test-target.sh")),
  run("audit SQL static validation", validateAuditSqlFiles),
  run("manifest.json schema", validateManifestJson),
  run("whitespace on harness files", checkWhitespace),
];

const ok = checks.every(Boolean);
console.log(
  ok
    ? "[validate-harness-local] ALL CHECKS PASSED"
    : "[validate-harness-local] ONE OR MORE CHECKS FAILED"
);
process.exit(ok ? 0 : 1);
