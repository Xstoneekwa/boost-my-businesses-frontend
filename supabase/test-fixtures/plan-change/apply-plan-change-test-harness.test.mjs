import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = dirname(fileURLToPath(import.meta.url));
const APPLY_SCRIPT = join(ROOT, "apply-plan-change-test-harness.sh");

function runApply(extraEnv = {}, extraEnvUnset = []) {
  const env = { ...process.env, ...extraEnv };
  for (const key of extraEnvUnset) {
    delete env[key];
  }
  try {
    const stdout = execFileSync("bash", [APPLY_SCRIPT], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const err = /** @type {Error & { status?: number, stdout?: string, stderr?: string }} */ (error);
    return {
      code: err.status ?? 1,
      output: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

describe("apply-plan-change-test-harness.sh guards", () => {
  const baseEnv = {
    PLAN_CHANGE_DB_TEST_CONFIRM: "isolated-test-only",
    PLAN_CHANGE_TEST_SUPABASE_URL: "https://nxntngkhkoynljcagmkq.supabase.co",
    PLAN_CHANGE_TEST_DATABASE_URL:
      "postgresql://postgres:local-only@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres",
  };

  it("refuses without PLAN_CHANGE_TEST_DATABASE_URL", () => {
    const result = runApply(baseEnv, ["PLAN_CHANGE_TEST_DATABASE_URL"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Missing required env var: PLAN_CHANGE_TEST_DATABASE_URL/);
    assert.ok(!result.output.includes("postgresql://postgres:local-only"));
  });

  it("refuses unexpected supabase project ref", () => {
    const result = runApply({
      ...baseEnv,
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://wrongref.supabase.co",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing unexpected project ref/);
  });

  it("refuses forbidden shared project ref zgafnshkjywfltxgbtzg", () => {
    const result = runApply({
      ...baseEnv,
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres:local-only@db.zgafnshkjywfltxgbtzg.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing forbidden shared project ref/);
    assert.ok(!result.output.includes("postgresql://"));
  });

  it("passes complete manifest gate then fails on missing snapshot (no written GO)", () => {
    const result = runApply(baseEnv);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Snapshot not found/);
    assert.ok(!result.output.includes("auditStatus is complete (current: partial)"));
  });

  it("accepts Session Pooler libpq string ref extraction before snapshot guard", () => {
    const result = runApply({
      ...baseEnv,
      PLAN_CHANGE_TEST_DATABASE_URL:
        "host=aws-0-eu-central-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.nxntngkhkoynljcagmkq password=REDACTED",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Snapshot not found/);
    assert.ok(!result.output.includes("Cannot parse project ref"));
  });
});
