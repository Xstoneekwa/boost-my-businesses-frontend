#!/usr/bin/env node
/**
 * Visual smoke fixture — two fictional @example.invalid users on isolated nxntng only.
 * Each user gets an independent Growth client/session/entitlement stack.
 * Passwords are written only to .run-state/ (never stdout).
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
  console.error(`[setup-visual-smoke] FAIL: ${message}`);
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

function buildAccount(prefix, runId) {
  return {
    email: `${prefix}_${runId}@example.invalid`,
    password: randomBytes(24).toString("base64url"),
    authUserId: randomUUID(),
    clientId: randomUUID(),
    sessionId: randomUUID(),
    entitlementId: randomUUID(),
  };
}

function buildVisualSmokeState(runId) {
  return {
    runId,
    mode: "visual-smoke",
    main: buildAccount("plan_change_ui_test", runId),
    paymentProbe: buildAccount("plan_change_ui_payment", runId),
    createdAt: new Date().toISOString(),
  };
}

function buildManifest(state) {
  return {
    runId: state.runId,
    mode: state.mode,
    mainEmail: state.main.email,
    paymentProbeEmail: state.paymentProbe.email,
    allowlistEmail: state.main.email,
    credentialsPath: "visual-smoke-latest.json",
    preparedAt: state.createdAt,
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
    fail(`Auth user creation failed for ${fixture} (${error?.message ?? "unknown"})`);
  }
  account.authUserId = data.user.id;
}

async function main() {
  assertEnv();
  const runId =
    process.env.PLAN_CHANGE_UI_API_RUN_ID?.trim() ||
    new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const state = buildVisualSmokeState(runId);

  const admin = createClient(
    process.env.PLAN_CHANGE_TEST_SUPABASE_URL,
    process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  await createAuthUser(admin, state.main, "plan_change_ui_visual_smoke_main", state.runId);
  await createAuthUser(admin, state.paymentProbe, "plan_change_ui_visual_smoke_payment_probe", state.runId);

  const runStateDir = join(ROOT, ".run-state");
  mkdirSync(runStateDir, { recursive: true });
  const statePath = join(runStateDir, `visual-smoke-${state.runId}.json`);
  const latestPath = join(runStateDir, "visual-smoke-latest.json");
  const manifestPath = join(runStateDir, "visual-smoke-manifest.json");

  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  writeFileSync(latestPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(buildManifest(state), null, 2)}\n`, "utf8");

  process.stdout.write(
    `${JSON.stringify({
      run_id: state.runId,
      main_email: state.main.email,
      payment_probe_email: state.paymentProbe.email,
      main_client_id: state.main.clientId,
      payment_client_id: state.paymentProbe.clientId,
      main_auth_user_id: state.main.authUserId,
      payment_auth_user_id: state.paymentProbe.authUserId,
      main_session_id: state.main.sessionId,
      payment_session_id: state.paymentProbe.sessionId,
      main_entitlement_id: state.main.entitlementId,
      payment_entitlement_id: state.paymentProbe.entitlementId,
      state_path: statePath,
      manifest_path: manifestPath,
    })}\n`,
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
