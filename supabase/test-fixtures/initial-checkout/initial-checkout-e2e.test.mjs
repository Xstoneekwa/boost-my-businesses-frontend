import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ALLOWED_SUPABASE_URL = "https://nxntngkhkoynljcagmkq.supabase.co";
const FORBIDDEN_SUPABASE_URL = "https://zgafnshkjywfltxgbtzg.supabase.co";

const baseEnv = {
  INITIAL_CHECKOUT_DB_TEST_CONFIRM: "isolated-test-only",
  INITIAL_CHECKOUT_TEST_SUPABASE_URL: ALLOWED_SUPABASE_URL,
  INITIAL_CHECKOUT_TEST_DATABASE_URL:
    "postgresql://postgres:local-only@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres",
  INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY: "test-service-role-key-local-only",
  INITIAL_CHECKOUT_TEST_ANON_KEY: "test-anon-key-local-only",
  SUPABASE_URL: ALLOWED_SUPABASE_URL,
  SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM: "isolated-test-only",
  SIMULATED_CHECKOUT_ENABLED: "true",
  SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "initial_checkout_test_20260615T120000Z@example.invalid",
  NEXT_PUBLIC_SUPABASE_URL: ALLOWED_SUPABASE_URL,
};

function runScript(script, args = [], extraEnv = {}, extraEnvUnset = []) {
  const env = { ...process.env, ...extraEnv };
  for (const key of extraEnvUnset) {
    delete env[key];
  }
  try {
    const stdout = execFileSync("bash", [join(ROOT, script), ...args], {
      cwd: ROOT,
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

function readHarnessFile(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}

describe("initial checkout harness guards", () => {
  it("preflight requires INITIAL_CHECKOUT_DB_TEST_CONFIRM", () => {
    const result = runScript("preflight-initial-checkout.sh", [], baseEnv, ["INITIAL_CHECKOUT_DB_TEST_CONFIRM"]);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /INITIAL_CHECKOUT_DB_TEST_CONFIRM=isolated-test-only/);
  });

  it("preflight refuses forbidden shared ref", () => {
    const result = runScript("preflight-initial-checkout.sh", [], {
      ...baseEnv,
      INITIAL_CHECKOUT_TEST_SUPABASE_URL: FORBIDDEN_SUPABASE_URL,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /forbidden shared project ref/);
  });

  it("start script requires SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM", () => {
    const result = runScript("start-initial-checkout-next.sh", [], {
      ...baseEnv,
      SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM: "",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM=isolated-test-only/);
  });

  it("prepare dry-run documents fictional emails and no pre-existing client", () => {
    const output = runScript("prepare-initial-checkout.sh", [], baseEnv).output;
    assert.match(output, /DRY-RUN MODE/);
    assert.match(output, /initial_checkout_test_/);
    assert.match(output, /initial_checkout_payment_/);
    assert.match(output, /No pre-existing client workspace/);
  });

  it("setup script guards isolated ref and never prints passwords on stdout contract", () => {
    const source = readHarnessFile("setup-initial-checkout.mjs");
    assert.match(source, /must target \$\{ALLOWED_REF\}/);
    assert.match(source, /initial-checkout-latest\.json/);
    const stdoutBlock = source.slice(source.indexOf("process.stdout.write"));
    assert.doesNotMatch(stdoutBlock, /password/);
    assert.match(source, /payment_probe_auth_user_id/);
    assert.doesNotMatch(source, /createAuthUser\(admin, state\.purchaser/);
  });

  it("common harness reuses plan-change audit helpers without modifying them", () => {
    const source = readHarnessFile("initial-checkout-common.sh");
    assert.match(source, /ui-api-e2e-common\.sh/);
    assert.match(source, /INITIAL_CHECKOUT_DB_TEST_CONFIRM/);
    assert.match(source, /SUPABASE_URL must target/);
    assert.doesNotMatch(source, /SIMULATED_CHECKOUT_ALLOW_PRODUCTION/);
  });

  it("manifest pins isolated ref and fictional email domain", () => {
    const manifest = JSON.parse(readHarnessFile("manifest.json"));
    assert.equal(manifest.allowedRef, "nxntngkhkoynljcagmkq");
    assert.equal(manifest.forbiddenRef, "zgafnshkjywfltxgbtzg");
    assert.equal(manifest.fictionalEmailDomain, "@example.invalid");
    assert.equal(manifest.requiredServerConfirm, "isolated-test-only");
  });

  it("runner documents plan change non-regression scenario", () => {
    const source = readHarnessFile("run-initial-checkout-e2e.mjs");
    assert.match(source, /plan_change_non_regression/);
    assert.match(source, /success_handoff_login_not_marketing/);
    assert.match(source, /idempotent_retry_no_duplicates/);
  });
});
