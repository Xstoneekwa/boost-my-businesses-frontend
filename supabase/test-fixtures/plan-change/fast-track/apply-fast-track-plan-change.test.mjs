import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = dirname(fileURLToPath(import.meta.url));
const APPLY_SCRIPT = join(ROOT, "apply-fast-track-plan-change.sh");
const BASELINE_SQL = join(ROOT, "bootstrap-fast-track-baseline.sql");
const SEED_SQL = join(ROOT, "seed-fast-track.sql");
const SMOKE_SQL = join(ROOT, "run-fast-track-smoke.sql");
const VERIFY_SQL = join(ROOT, "verify-fast-track-results.sql");

const STRICT_PERIOD_END_STRING = "2026-12-31T23:59:59+00";

const ALLOWED_DATABASE_URL =
  "postgresql://postgres:local-only@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres";

function runApply(args = [], extraEnv = {}, extraEnvUnset = []) {
  const env = { ...process.env, ...extraEnv };
  for (const key of extraEnvUnset) {
    delete env[key];
  }
  try {
    const stdout = execFileSync("bash", [APPLY_SCRIPT, ...args], {
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

describe("apply-fast-track-plan-change.sh guards", () => {
  const baseEnv = {
    PLAN_CHANGE_DB_TEST_CONFIRM: "isolated-test-only",
    PLAN_CHANGE_TEST_DATABASE_URL: ALLOWED_DATABASE_URL,
  };

  it("refuses without PLAN_CHANGE_TEST_DATABASE_URL", () => {
    const result = runApply([], baseEnv, ["PLAN_CHANGE_TEST_DATABASE_URL"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Missing required env var: PLAN_CHANGE_TEST_DATABASE_URL/);
    assert.ok(!result.output.includes("postgresql://postgres:local-only"));
  });

  it("refuses without PLAN_CHANGE_DB_TEST_CONFIRM", () => {
    const result = runApply([], baseEnv, ["PLAN_CHANGE_DB_TEST_CONFIRM"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only/);
  });

  it("refuses forbidden shared project ref zgafnshkjywfltxgbtzg", () => {
    const result = runApply([], {
      ...baseEnv,
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres:local-only@db.zgafnshkjywfltxgbtzg.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing forbidden shared project ref/);
    assert.ok(!result.output.includes("postgresql://"));
  });

  it("refuses unexpected project ref", () => {
    const result = runApply([], {
      ...baseEnv,
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres:local-only@db.wrongref.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing unexpected project ref/);
  });

  it("dry-run by default without --apply (no psql execution message)", () => {
    const result = runApply([], baseEnv);
    assert.equal(result.code, 0);
    assert.match(result.output, /DRY-RUN MODE/);
    assert.match(result.output, /Pass --apply/);
    assert.doesNotMatch(result.output, /APPLY MODE/);
  });

  it("does not invoke supabase db push", () => {
    const script = readFileSync(APPLY_SCRIPT, "utf8");
    const executableLines = script
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(executableLines, /supabase db push/);
  });

  it("does not read .env.local from executable lines", () => {
    const script = readFileSync(APPLY_SCRIPT, "utf8");
    const executableLines = script
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(executableLines, /\.env\.local/);
    assert.match(script, /audit_refuse_env_local/);
  });

  it("refuses combining --apply and --verify-only", () => {
    const result = runApply(["--apply", "--verify-only"], baseEnv);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Cannot combine --apply and --verify-only/);
  });

  it("--verify-only mode does not reference bootstrap, migration, or seed apply steps", () => {
    const script = readFileSync(APPLY_SCRIPT, "utf8");
    const verifyStart = script.indexOf('if [[ "${verify_mode}" == "true" ]]; then');
    const verifyEnd = script.indexOf("exit 0", verifyStart) + "exit 0".length;
    const verifyBlock = script.slice(verifyStart, verifyEnd);
    assert.match(verifyBlock, /run_psql_verify/);
    assert.doesNotMatch(verifyBlock, /bootstrap-fast-track-baseline/);
    assert.doesNotMatch(verifyBlock, /commercial_plan_change\.sql/);
    assert.doesNotMatch(verifyBlock, /seed-fast-track\.sql/);
    assert.doesNotMatch(verifyBlock, /run-fast-track-smoke\.sql/);
    assert.doesNotMatch(verifyBlock, /run_psql "\$\{BASELINE_SQL\}"/);
  });

  it("dry-run mentions --verify-only read-only path", () => {
    const result = runApply([], baseEnv);
    assert.equal(result.code, 0);
    assert.match(result.output, /--verify-only/);
    assert.match(result.output, /verify-fast-track-results\.sql/);
  });
});

describe("fast-track fixture static contracts", () => {
  const baseline = readFileSync(BASELINE_SQL, "utf8");
  const seed = readFileSync(SEED_SQL, "utf8");
  const smoke = readFileSync(SMOKE_SQL, "utf8");
  const verify = readFileSync(VERIFY_SQL, "utf8");

  function executableSql(sql) {
    return sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
  }
  it("bootstrap stays in Plan Change scope and does not recreate auth.users", () => {
    const sql = executableSql(baseline);
    assert.match(baseline, /commercial_checkout_sessions/);
    assert.match(baseline, /client_account_entitlements/);
    assert.match(baseline, /commercial_checkout_audit_events/);
    assert.doesNotMatch(sql, /create\s+table\s+auth\.users/i);
    assert.doesNotMatch(sql, /drop\s+schema/i);
  });

  it("seed uses plan_change_test_ prefix for fictional data", () => {
    assert.match(seed, /plan_change_test_/);
    assert.doesNotMatch(seed, /@gmail\.com/i);
    assert.doesNotMatch(seed, /@instagram\.com/i);
  });

  it("smoke includes all five mandatory scenarios A–E", () => {
    const scenarios = [
      "A_upgrade_payment_required",
      "B_upgrade_simulated_activation",
      "C_downgrade_credit_no_cash",
      "D_credit_reused_remainder",
      "E_idempotence_no_duplicate",
    ];
    for (const scenario of scenarios) {
      assert.match(smoke, new RegExp(scenario));
    }
    assert.match(smoke, /fast_track_smoke_results/);
    assert.match(smoke, /scenario.*status.*expected.*actual.*details_safe/s);
  });

  it("verify SQL is read-only without RPC or persistent mutations", () => {
    const sql = executableSql(verify);
    assert.doesNotMatch(sql, /activate_commercial_plan_change/i);
    assert.doesNotMatch(sql, /\binsert\s+into\s+public\./i);
    assert.doesNotMatch(sql, /\bupdate\s+public\./i);
    assert.doesNotMatch(sql, /\bdelete\s+from\s+public\./i);
    assert.match(verify, /read-only verification/i);
  });

  it("verify includes all five mandatory scenarios A–E", () => {
    const scenarios = [
      "A_upgrade_payment_required",
      "B_upgrade_simulated_activation",
      "C_downgrade_credit_no_cash",
      "D_credit_reused_remainder",
      "E_idempotence_no_duplicate",
    ];
    for (const scenario of scenarios) {
      assert.match(verify, new RegExp(scenario));
    }
  });

  it("smoke and verify compare period_end_at as timestamptz, not strict JSON strings", () => {
    for (const sql of [smoke, verify]) {
      assert.match(sql, /::timestamptz/);
      assert.doesNotMatch(sql, new RegExp(`= '${STRICT_PERIOD_END_STRING}'`));
    }
    assert.match(smoke, /v_expected_period_end timestamptz/);
    assert.match(verify, /expected_period_end as/);
    assert.match(verify, /period_end_ts = e\.ts/);
  });
});
