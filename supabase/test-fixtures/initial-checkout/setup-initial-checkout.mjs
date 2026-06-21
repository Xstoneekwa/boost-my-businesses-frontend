#!/usr/bin/env node
/**
 * Initial checkout fixture — fictional purchaser + payment probe only.
 * No pre-existing client workspace. Passwords written to .run-state/ only.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ALLOWED_REF = "nxntngkhkoynljcagmkq";
const FORBIDDEN_REF = "zgafnshkjywfltxgbtzg";

function fail(message) {
  console.error(`[setup-initial-checkout] FAIL: ${message}`);
  process.exit(1);
}

function assertEnv() {
  if (process.env.INITIAL_CHECKOUT_DB_TEST_CONFIRM !== "isolated-test-only") {
    fail("Set INITIAL_CHECKOUT_DB_TEST_CONFIRM=isolated-test-only");
  }
  const url = process.env.INITIAL_CHECKOUT_TEST_SUPABASE_URL ?? "";
  const ref = url.match(/^https?:\/\/([^.]+)\./i)?.[1]?.toLowerCase() ?? "";
  if (!url) fail("Missing INITIAL_CHECKOUT_TEST_SUPABASE_URL");
  if (ref === FORBIDDEN_REF) fail(`Refusing forbidden ref ${FORBIDDEN_REF}`);
  if (ref !== ALLOWED_REF) fail(`INITIAL_CHECKOUT_TEST_SUPABASE_URL must target ${ALLOWED_REF}`);
  if (!process.env.INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY) {
    fail("Missing INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY");
  }
  for (const name of Object.keys(process.env)) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    const value = process.env[name] ?? "";
    if (value && value === process.env.INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY) {
      fail(`Service role key must not be exported via ${name}`);
    }
  }
}

function buildRunState(runId) {
  const purchaserEmail = `initial_checkout_test_${runId}@example.invalid`;
  const paymentProbeEmail = `initial_checkout_payment_${runId}@example.invalid`;
  return {
    runId,
    mode: "initial-checkout",
    purchaser: {
      email: purchaserEmail,
      password: randomBytes(24).toString("base64url"),
    },
    paymentProbe: {
      email: paymentProbeEmail,
      password: randomBytes(24).toString("base64url"),
    },
    allowlistEmail: purchaserEmail,
    credentialsPath: "initial-checkout-latest.json",
    preparedAt: new Date().toISOString(),
  };
}

async function createAuthUser(admin, account, fixture, runId) {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { fixture, run_id: runId },
  });
  if (error || !data.user?.id) {
    fail(`Auth user create failed for ${account.email}: ${error?.message ?? "unknown"}`);
  }
  return data.user.id;
}

async function main() {
  assertEnv();
  const runId = process.env.INITIAL_CHECKOUT_RUN_ID?.trim() || new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const state = buildRunState(runId);
  const admin = createClient(
    process.env.INITIAL_CHECKOUT_TEST_SUPABASE_URL,
    process.env.INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  state.paymentProbe.authUserId = await createAuthUser(admin, state.paymentProbe, "initial_checkout_payment_probe", runId);

  const runStateDir = join(ROOT, ".run-state");
  mkdirSync(runStateDir, { recursive: true, mode: 0o700 });
  const latestPath = join(runStateDir, "initial-checkout-latest.json");
  const runPath = join(runStateDir, `initial-checkout-${runId}.json`);
  const manifestPath = join(runStateDir, "initial-checkout-manifest.json");
  writeFileSync(latestPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(runPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      runId,
      mode: "initial-checkout",
      purchaserEmail: state.purchaser.email,
      paymentProbeEmail: state.paymentProbe.email,
      allowlistEmail: state.allowlistEmail,
      credentialsPath: state.credentialsPath,
      preparedAt: state.preparedAt,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );

  process.stdout.write(`${JSON.stringify({
    run_id: runId,
    purchaser_email: state.purchaser.email,
    payment_probe_email: state.paymentProbe.email,
    purchaser_auth_user_id: null,
    payment_probe_auth_user_id: state.paymentProbe.authUserId,
  })}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
