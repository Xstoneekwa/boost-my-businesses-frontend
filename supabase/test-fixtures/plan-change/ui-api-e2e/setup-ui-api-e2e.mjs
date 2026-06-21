#!/usr/bin/env node
/**
 * UI/API E2E fixture — create fictional auth user and local run state (isolated DB only).
 * Uses PLAN_CHANGE_TEST_* env vars. Never reads .env.local.
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
  console.error(`[setup-ui-api-e2e] FAIL: ${message}`);
  process.exit(1);
}

function extractRef(url) {
  const match = String(url).match(/^https?:\/\/([^.]+)\./);
  return match?.[1] ?? "";
}

function assertEnv() {
  if (process.env.PLAN_CHANGE_DB_TEST_CONFIRM !== "isolated-test-only") {
    fail("Set PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only");
  }
  if (process.env.DOTENV_CONFIG_PATH?.includes(".env.local") || process.env.ENV_FILE?.includes(".env.local")) {
    fail("Refusing .env.local as credential source");
  }
  const url = process.env.PLAN_CHANGE_TEST_SUPABASE_URL ?? "";
  const ref = extractRef(url);
  if (!url) fail("Missing PLAN_CHANGE_TEST_SUPABASE_URL");
  if (ref === FORBIDDEN_REF) fail(`Refusing forbidden shared ref ${FORBIDDEN_REF}`);
  if (ref !== ALLOWED_REF) fail(`PLAN_CHANGE_TEST_SUPABASE_URL must target ${ALLOWED_REF}`);
  if (!process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY) {
    fail("Missing PLAN_CHANGE_TEST_SERVICE_ROLE_KEY");
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    if (value && value === process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY) {
      fail(`Service role key must not be exported via ${key}`);
    }
  }
}

function buildRunState(runId) {
  const email = `plan_change_ui_test_${runId}@example.invalid`;
  const paymentProbeEmail = `plan_change_ui_payment_${runId}@example.invalid`;
  return {
    runId,
    email,
    password: randomBytes(24).toString("base64url"),
    authUserId: randomUUID(),
    paymentProbeEmail,
    paymentProbePassword: randomBytes(24).toString("base64url"),
    paymentProbeAuthUserId: randomUUID(),
    clientId: randomUUID(),
    sessionId: randomUUID(),
    entitlementId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  assertEnv();
  const runId = process.env.PLAN_CHANGE_UI_API_RUN_ID?.trim() || new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const state = buildRunState(runId);

  const admin = createClient(
    process.env.PLAN_CHANGE_TEST_SUPABASE_URL,
    process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await admin.auth.admin.createUser({
    email: state.email,
    password: state.password,
    email_confirm: true,
    user_metadata: { fixture: "plan_change_ui_test", run_id: state.runId },
  });

  if (error || !data.user?.id) {
    fail(`Auth user creation failed (${error?.message ?? "unknown"})`);
  }

  state.authUserId = data.user.id;

  const { data: paymentProbe, error: paymentProbeError } = await admin.auth.admin.createUser({
    email: state.paymentProbeEmail,
    password: state.paymentProbePassword,
    email_confirm: true,
    user_metadata: { fixture: "plan_change_ui_payment_probe", run_id: state.runId },
  });

  if (paymentProbeError || !paymentProbe.user?.id) {
    fail(`Payment probe auth user creation failed (${paymentProbeError?.message ?? "unknown"})`);
  }

  state.paymentProbeAuthUserId = paymentProbe.user.id;

  const runStateDir = join(ROOT, ".run-state");
  mkdirSync(runStateDir, { recursive: true });
  const statePath = join(runStateDir, `${state.runId}.json`);
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  writeFileSync(join(runStateDir, "latest.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({
    run_id: state.runId,
    email: state.email,
    auth_user_id: state.authUserId,
    payment_probe_email: state.paymentProbeEmail,
    payment_probe_auth_user_id: state.paymentProbeAuthUserId,
    client_id: state.clientId,
    session_id: state.sessionId,
    entitlement_id: state.entitlementId,
    state_path: statePath,
  })}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
