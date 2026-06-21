import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PREFLIGHT_SCRIPT = join(ROOT, "preflight-ui-api-e2e.sh");
const APPLY_SCRIPT = join(ROOT, "apply-ui-api-e2e.sh");
const PREPARE_VISUAL_SCRIPT = join(ROOT, "prepare-visual-smoke.sh");
const START_VISUAL_SCRIPT = join(ROOT, "start-visual-smoke-next.sh");
const COMMON_SCRIPT = join(ROOT, "ui-api-e2e-common.sh");
const SETUP_MJS = join(ROOT, "setup-ui-api-e2e.mjs");
const SETUP_VISUAL_MJS = join(ROOT, "setup-visual-smoke.mjs");
const RUN_MJS = join(ROOT, "run-ui-api-e2e.mjs");
const SEED_SQL = join(ROOT, "seed-ui-api-e2e.sql");
const SEED_VISUAL_SQL = join(ROOT, "seed-visual-smoke.sql");
const README = join(ROOT, "README.md");

const ALLOWED_DATABASE_URL =
  "postgresql://postgres:local-only@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres";
const ALLOWED_SUPABASE_URL = "https://nxntngkhkoynljcagmkq.supabase.co";

function runBash(script, args = [], extraEnv = {}, extraEnvUnset = []) {
  const env = { ...process.env, ...extraEnv };
  for (const key of extraEnvUnset) {
    delete env[key];
  }
  try {
    const stdout = execFileSync("bash", [script, ...args], {
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

function executableLines(scriptPath) {
  const script = readFileSync(scriptPath, "utf8");
  return script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

const baseEnv = {
  PLAN_CHANGE_DB_TEST_CONFIRM: "isolated-test-only",
  PLAN_CHANGE_TEST_SUPABASE_URL: ALLOWED_SUPABASE_URL,
  PLAN_CHANGE_TEST_DATABASE_URL: ALLOWED_DATABASE_URL,
  PLAN_CHANGE_TEST_SERVICE_ROLE_KEY: "test-service-role-key-local-only",
  PLAN_CHANGE_TEST_ANON_KEY: "test-anon-key-local-only",
};

describe("preflight-ui-api-e2e.sh guards", () => {
  it("refuses without PLAN_CHANGE_DB_TEST_CONFIRM", () => {
    const result = runBash(PREFLIGHT_SCRIPT, [], baseEnv, ["PLAN_CHANGE_DB_TEST_CONFIRM"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only/);
  });

  it("refuses forbidden shared project ref zgafnshkjywfltxgbtzg", () => {
    const result = runBash(PREFLIGHT_SCRIPT, [], {
      ...baseEnv,
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres:local-only@db.zgafnshkjywfltxgbtzg.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing forbidden shared project ref/);
    assert.ok(!result.output.includes("postgresql://"));
  });

  it("refuses unexpected project ref", () => {
    const result = runBash(PREFLIGHT_SCRIPT, [], {
      ...baseEnv,
      PLAN_CHANGE_TEST_DATABASE_URL:
        "postgresql://postgres:local-only@db.wrongref.supabase.co:5432/postgres",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /must target nxntngkhkoynljcagmkq/);
  });

  it("preflight executable lines do not write fixture data", () => {
    const lines = executableLines(PREFLIGHT_SCRIPT);
    assert.doesNotMatch(lines, /setup-ui-api-e2e\.mjs/);
    assert.doesNotMatch(lines, /seed-ui-api-e2e\.sql/);
    assert.doesNotMatch(lines, /bootstrap-ui-api-minimal\.sql/);
    assert.doesNotMatch(lines, /createUser/);
    assert.match(lines, /--verify-only/);
  });

  it("does not read .env.local from executable lines", () => {
    const lines = executableLines(PREFLIGHT_SCRIPT);
    assert.doesNotMatch(lines, /\.env\.local/);
    assert.match(readFileSync(PREFLIGHT_SCRIPT, "utf8"), /ui_api_assert_core_env/);
    assert.match(readFileSync(COMMON_SCRIPT, "utf8"), /audit_refuse_env_local/);
  });
});

describe("apply-ui-api-e2e.sh guards", () => {
  it("dry-run by default without --apply", () => {
    const result = runBash(APPLY_SCRIPT, [], baseEnv);
    assert.equal(result.code, 0);
    assert.match(result.output, /DRY-RUN MODE/);
    assert.match(result.output, /pass --apply/);
    assert.doesNotMatch(result.output, /APPLY MODE/);
  });

  it("refuses without PLAN_CHANGE_DB_TEST_CONFIRM", () => {
    const result = runBash(APPLY_SCRIPT, ["--apply"], baseEnv, ["PLAN_CHANGE_DB_TEST_CONFIRM"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only/);
  });

  it("refuses forbidden shared project ref zgafnshkjywfltxgbtzg", () => {
    const result = runBash(APPLY_SCRIPT, ["--apply"], {
      ...baseEnv,
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing forbidden shared project ref/);
  });

  it("does not invoke supabase db push", () => {
    const lines = executableLines(APPLY_SCRIPT);
    assert.doesNotMatch(lines, /supabase db push/);
  });

  it("does not read .env.local from executable lines", () => {
    const lines = executableLines(APPLY_SCRIPT);
    assert.doesNotMatch(lines, /\.env\.local/);
  });

  it("requires SIMULATED_CHECKOUT_ENABLED=true with --apply", () => {
    const result = runBash(
      APPLY_SCRIPT,
      ["--apply"],
      { ...baseEnv, SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "plan_change_ui_test_20260615T120000Z@example.invalid" },
      ["SIMULATED_CHECKOUT_ENABLED"],
    );
    assert.notEqual(result.code, 0);
    assert.match(result.output, /SIMULATED_CHECKOUT_ENABLED=true/);
  });
});

describe("ui-api-e2e service role and fixture contracts", () => {
  it("refuses service role key exported via NEXT_PUBLIC_*", () => {
    const result = runBash(PREFLIGHT_SCRIPT, [], {
      ...baseEnv,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: baseEnv.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Service role key must not be exported via NEXT_PUBLIC_/);
  });

  it("setup-ui-api-e2e.mjs refuses service role in NEXT_PUBLIC_* and .env.local credential source", () => {
    const setupSource = readFileSync(SETUP_MJS, "utf8");
    assert.match(setupSource, /NEXT_PUBLIC_/);
    assert.match(setupSource, /PLAN_CHANGE_TEST_SERVICE_ROLE_KEY/);
    assert.match(setupSource, /example\.invalid/);
    assert.match(setupSource, /Refusing \.env\.local as credential source/);
  });

  it("seed SQL uses only fictional plan_change_ui_test_ prefixes", () => {
    const seed = readFileSync(SEED_SQL, "utf8");
    assert.match(seed, /plan_change_ui_test_/);
    assert.doesNotMatch(seed, /@gmail\.com|@yahoo\.com|@hotmail\.com/);
    assert.doesNotMatch(seed, /real_client|production_client/i);
  });

  it("run-ui-api-e2e.mjs uses example.invalid fictional domain only", () => {
    const runSource = readFileSync(RUN_MJS, "utf8");
    assert.match(runSource, /example\.invalid/);
    assert.doesNotMatch(runSource, /\.env\.local/);
  });

  it("run-ui-api-e2e requires amount_due > 0 assertion for payment scenario", () => {
    const source = readFileSync(join(ROOT, "run-ui-api-e2e.mjs"), "utf8");
    assert.match(source, /paymentAmountDue > 0/);
    assert.doesNotMatch(source, /SKIP.*payment|payment.*SKIP/i);
  });

  it("bootstrap includes clients.status and client_instagram_accounts", () => {
    const bootstrap = readFileSync(join(ROOT, "bootstrap-ui-api-minimal.sql"), "utf8");
    assert.match(bootstrap, /clients.*status/s);
    assert.match(bootstrap, /client_instagram_accounts/);
  });
});

describe("prepare-visual-smoke.sh guards", () => {
  it("dry-run by default without --apply", () => {
    const result = runBash(PREPARE_VISUAL_SCRIPT, [], baseEnv);
    assert.equal(result.code, 0);
    assert.match(result.output, /DRY-RUN MODE/);
    assert.match(result.output, /pass --apply/);
    assert.match(result.output, /Payment probe email/);
    assert.doesNotMatch(result.output, /APPLY MODE/);
  });

  it("refuses without PLAN_CHANGE_DB_TEST_CONFIRM", () => {
    const result = runBash(PREPARE_VISUAL_SCRIPT, ["--apply"], baseEnv, ["PLAN_CHANGE_DB_TEST_CONFIRM"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only/);
  });

  it("refuses forbidden shared project ref zgafnshkjywfltxgbtzg", () => {
    const result = runBash(PREPARE_VISUAL_SCRIPT, ["--apply"], {
      ...baseEnv,
      PLAN_CHANGE_TEST_SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Refusing forbidden shared project ref/);
  });

  it("does not invoke run-ui-api-e2e or automatic activation", () => {
    const lines = executableLines(PREPARE_VISUAL_SCRIPT);
    assert.doesNotMatch(lines, /run-ui-api-e2e\.mjs/);
    assert.doesNotMatch(lines, /activate_commercial_plan_change/);
    assert.doesNotMatch(lines, /supabase db push/);
    assert.match(lines, /seed-visual-smoke\.sql/);
    assert.match(lines, /setup-visual-smoke\.mjs/);
  });

  it("does not print passwords in executable lines", () => {
    const lines = executableLines(PREPARE_VISUAL_SCRIPT);
    assert.doesNotMatch(lines, /password:/i);
    assert.doesNotMatch(lines, /\.password/);
    assert.match(lines, /not printed/);
  });

  it("does not read .env.local from executable lines", () => {
    const lines = executableLines(PREPARE_VISUAL_SCRIPT);
    assert.doesNotMatch(lines, /\.env\.local/);
  });
});

describe("start-visual-smoke-next.sh guards", () => {
  it("refuses forbidden NEXT_PUBLIC_SUPABASE_URL ref", () => {
    const result = runBash(START_VISUAL_SCRIPT, [], {
      NEXT_PUBLIC_SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SIMULATED_CHECKOUT_ENABLED: "true",
      SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "plan_change_ui_test_20260615T120000Z@example.invalid",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /forbidden shared ref/);
  });

  it("refuses service role exported via NEXT_PUBLIC_*", () => {
    const result = runBash(START_VISUAL_SCRIPT, [], {
      NEXT_PUBLIC_SUPABASE_URL: ALLOWED_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "same-key",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "same-key",
      SUPABASE_SERVICE_ROLE_KEY: "same-key",
      SIMULATED_CHECKOUT_ENABLED: "true",
      SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "plan_change_ui_test_20260615T120000Z@example.invalid",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /must not be exported via NEXT_PUBLIC_/);
  });

  it("requires SIMULATED_CHECKOUT_ENABLED=true", () => {
    const result = runBash(
      START_VISUAL_SCRIPT,
      [],
      {
        NEXT_PUBLIC_SUPABASE_URL: ALLOWED_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "plan_change_ui_test_20260615T120000Z@example.invalid",
      },
      ["SIMULATED_CHECKOUT_ENABLED"],
    );
    assert.notEqual(result.code, 0);
    assert.match(result.output, /SIMULATED_CHECKOUT_ENABLED=true/);
  });

  it("requires visual smoke manifest from prepare step", () => {
    const result = runBash(START_VISUAL_SCRIPT, [], {
      NEXT_PUBLIC_SUPABASE_URL: ALLOWED_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SIMULATED_CHECKOUT_ENABLED: "true",
      SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "plan_change_ui_test_20260615T120000Z@example.invalid",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /visual-smoke-manifest\.json/);
  });

  it("does not read or modify .env.local", () => {
    const lines = executableLines(START_VISUAL_SCRIPT);
    assert.doesNotMatch(lines, /\.env\.local/);
    assert.match(lines, /ui_api_refuse_automatic_env_local/);
  });

  it("does not print passwords in executable lines", () => {
    const lines = executableLines(START_VISUAL_SCRIPT);
    assert.doesNotMatch(lines, /password:/i);
    assert.match(lines, /not printed/);
  });
});

describe("visual smoke fixture contracts", () => {
  it("setup-visual-smoke.mjs creates two independent Growth stacks without stdout passwords", () => {
    const source = readFileSync(SETUP_VISUAL_MJS, "utf8");
    assert.match(source, /plan_change_ui_test/);
    assert.match(source, /plan_change_ui_payment/);
    assert.match(source, /visual-smoke-latest\.json/);
    assert.match(source, /visual-smoke-manifest\.json/);
    const stdoutBlock = source.slice(source.indexOf("process.stdout.write"));
    assert.doesNotMatch(stdoutBlock, /password/);
    assert.match(source, /Refusing \.env\.local as credential source/);
  });

  it("seed-visual-smoke.sql seeds two Growth clients with proration-friendly period_end_at", () => {
    const seed = readFileSync(SEED_VISUAL_SQL, "utf8");
    assert.match(seed, /ui_main_client_id/);
    assert.match(seed, /ui_payment_client_id/);
    assert.match(seed, /'growth'/);
    assert.match(seed, /2027-06-01T12:00:00\.000Z/);
    assert.doesNotMatch(seed, /@gmail\.com|@yahoo\.com/);
  });

  it("README documents human browser flow without embedding passwords", () => {
    const readme = readFileSync(README, "utf8");
    assert.match(readme, /prepare-visual-smoke\.sh --apply/);
    assert.match(readme, /start-visual-smoke-next\.sh/);
    assert.match(readme, /payment_required/);
    assert.match(readme, /visual-smoke-latest\.json/);
    assert.doesNotMatch(readme, /UhSLlTcKUk9LWqqyMuJxoehtTu2hRX7R/);
    assert.doesNotMatch(readme, /password.*=.*['"][A-Za-z0-9+/=_-]{8,}/);
  });
});
