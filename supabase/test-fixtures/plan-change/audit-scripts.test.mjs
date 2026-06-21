import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { AUDIT_SQL_FILES, validateAuditSqlContent } from "./validate-audit-sql.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

function runBash(scriptName, extraEnv = {}, unset = []) {
  const env = { ...process.env, ...extraEnv };
  for (const key of unset) delete env[key];
  try {
    execFileSync("bash", [join(ROOT, scriptName)], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: "" };
  } catch (error) {
    const err = /** @type {Error & { status?: number, stdout?: string, stderr?: string }} */ (error);
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function readText(name) {
  return readFileSync(join(ROOT, name), "utf8");
}

describe("audit shell scripts guards", () => {
  it("audit-reference-schema refuses unexpected source ref", () => {
    const result = runBash("audit-reference-schema.sh", {
      REFERENCE_SCHEMA_PROJECT_REF: "wrongref",
      REFERENCE_SCHEMA_DATABASE_URL:
        "postgresql://postgres:secret@db.wrongref.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing unexpected source project ref/);
    assert.ok(!result.output.includes("postgresql://"));
    assert.ok(!result.output.includes("PGOPTIONS"));
  });

  it("audit-test-target refuses unexpected test ref", () => {
    const result = runBash("audit-test-target.sh", {
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://wrongref.supabase.co",
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres:secret@db.wrongref.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing unexpected project ref/);
    assert.ok(!result.output.includes("postgresql://"));
  });

  it("audit-test-target refuses forbidden shared ref zgafnshkjywfltxgbtzg", () => {
    const result = runBash("audit-test-target.sh", {
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres:secret@db.zgafnshkjywfltxgbtzg.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing forbidden shared project ref/);
    assert.ok(!result.output.includes("postgresql://"));
  });

  it("audit scripts redact database URLs in error output", () => {
    const result = runBash("audit-reference-schema.sh", {
      REFERENCE_SCHEMA_PROJECT_REF: "zgafnshkjywfltxgbtzg",
      REFERENCE_SCHEMA_DATABASE_URL: "not-a-valid-url",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /URL not logged/);
    assert.ok(!result.output.includes("not-a-valid-url"));
  });

  it("audit-common.sh uses psql -X, ON_ERROR_STOP and read-only PGOPTIONS", () => {
    const common = readText("audit-common.sh");
    assert.match(common, /psql\s+-X/);
    assert.match(common, /ON_ERROR_STOP=1/);
    assert.match(common, /PGOPTIONS=/);
    assert.match(common, /default_transaction_read_only=on/);
    assert.match(common, /statement_timeout=15000/);
    assert.match(common, /lock_timeout=3000/);
  });

  it("audit-test-target accepts Session Pooler libpq string before psql step", () => {
    const result = runBash("audit-test-target.sh", {
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://nxntngkhkoynljcagmkq.supabase.co",
      PLAN_CHANGE_TEST_DATABASE_URL:
        "host=aws-0-eu-central-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.nxntngkhkoynljcagmkq password=REDACTED",
    });
    assert.notEqual(result.code, 0);
    assert.ok(!result.output.includes("Cannot parse project ref"));
    assert.ok(!result.output.includes("password="));
    assert.ok(!result.output.includes("pooler.supabase.com"));
  });

  it("audit-test-target accepts Session Pooler 5432 URI before psql step", () => {
    const result = runBash("audit-test-target.sh", {
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://nxntngkhkoynljcagmkq.supabase.co",
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres.nxntngkhkoynljcagmkq:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.ok(!result.output.includes("Cannot parse project ref"));
    assert.ok(!result.output.includes("postgresql://"));
    assert.ok(!result.output.includes("pooler.supabase.com"));
  });

  it("audit-test-target refuses Transaction Pooler port 6543", () => {
    const result = runBash("audit-test-target.sh", {
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://nxntngkhkoynljcagmkq.supabase.co",
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres.nxntngkhkoynljcagmkq:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Session Pooler on port 5432/);
    assert.ok(!result.output.includes("postgresql://"));
  });

  it("audit SQL files pass static validator before future execution", () => {
    for (const file of AUDIT_SQL_FILES) {
      validateAuditSqlContent(readText(file), file);
    }
  });
});

describe("harness tree integrity", () => {
  const EXPECTED = [
    ".gitignore",
    "README.md",
    "apply-plan-change-test-harness.sh",
    "apply-plan-change-test-harness.test.mjs",
    "audit-common.sh",
    "audit-reference-schema.sh",
    "audit-minimal-baseline-contract.sql",
    "audit-minimal-trigger-functions.sql",
    "audit-minimal-extension-usage.sql",
    "audit-reference-schema.sql",
    "audit-scripts.test.mjs",
    "audit-sql-validation.test.mjs",
    "audit-test-target.sh",
    "audit-test-target.sql",
    "classify-environment.test.mjs",
    "docs/plan-change-test-harness.md",
    "fast-track",
    "ui-api-e2e",
    "harness-contract.mjs",
    "harness-manifest-contract.mjs",
    "harness-manifest-contract.test.mjs",
    "manifest.json",
    "postgres-url-ref.mjs",
    "postgres-url-ref.test.mjs",
    "snapshot-validation-rules.mjs",
    "snapshot-validation-rules.test.mjs",
    "validate-audit-sql.mjs",
    "validate-harness-local.mjs",
    "verify-schema-only-snapshot.mjs",
  ].sort();

  it("has exact harness file set without duplicate harness-contract.mjs", () => {
    const files = readdirSync(ROOT, { recursive: true })
      .map((f) => String(f).replace(/\\/g, "/"))
      .filter((f) => !f.startsWith("docs/") || f === "docs/plan-change-test-harness.md")
      .filter((f) => f !== "docs" && !f.endsWith("/"))
      .sort();
    const topAndDocs = files.filter(
      (f) => !f.includes("/") || f === "docs/plan-change-test-harness.md"
    );
    assert.deepEqual(topAndDocs, EXPECTED);
    assert.equal(
      topAndDocs.filter((f) => f === "harness-contract.mjs").length,
      1,
      "harness-contract.mjs must appear exactly once"
    );
  });
});
