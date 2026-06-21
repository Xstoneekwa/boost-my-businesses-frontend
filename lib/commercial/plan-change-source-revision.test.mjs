import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadCommercialPlanChangeSourceRevision } from "./plan-change-source.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(ROOT, "../..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "supabase/migrations/20260622120000_commercial_plan_change_source_revision.sql",
);

const FIXTURE_ENTITLEMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const FIXTURE_SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIXTURE_PERIOD_VALUE_CENTS = 120_000;
const FIXTURE_REVISION = "fixture-revision-hash-no-secrets";

test("migration defines canonical PostgreSQL source_revision contract", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /create or replace function public\.commercial_plan_change_source_revision\(/);
  assert.match(sql, /p_entitlement_updated_at::text/);
  assert.match(sql, /p_session_updated_at::text/);
  assert.match(sql, /p_plan_key/);
  assert.match(sql, /p_active_commercial_period_value_cents::text/);
  assert.match(sql, /p_entitlement_id::text/);
  assert.match(sql, /p_session_id::text/);
  assert.match(sql, /commercial_plan_change_source_revision_for_source/);
  assert.match(sql, /v_current_revision := public\.commercial_plan_change_source_revision_for_source\(/);
  assert.doesNotMatch(sql, /@example\.com|password|service_role_key/i);
});

test("loadCommercialPlanChangeSourceRevision calls postgres rpc with ids only", async () => {
  const rpcCalls = [];
  const supabase = {
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: FIXTURE_REVISION, error: null };
    },
  };

  const revision = await loadCommercialPlanChangeSourceRevision(supabase, {
    entitlementId: FIXTURE_ENTITLEMENT_ID,
    sessionId: FIXTURE_SESSION_ID,
    activeCommercialPeriodValueCents: FIXTURE_PERIOD_VALUE_CENTS,
  });

  assert.equal(revision, FIXTURE_REVISION);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "commercial_plan_change_source_revision_for_source");
  assert.deepEqual(rpcCalls[0].args, {
    p_entitlement_id: FIXTURE_ENTITLEMENT_ID,
    p_session_id: FIXTURE_SESSION_ID,
    p_active_commercial_period_value_cents: FIXTURE_PERIOD_VALUE_CENTS,
  });
  assert.doesNotMatch(JSON.stringify(rpcCalls[0].args), /password|@gmail|service_role/i);
});

test("loadCommercialPlanChangeSourceRevision returns null when rpc fails", async () => {
  const supabase = {
    rpc() {
      return { data: null, error: { message: "rpc unavailable" } };
    },
  };

  const revision = await loadCommercialPlanChangeSourceRevision(supabase, {
    entitlementId: FIXTURE_ENTITLEMENT_ID,
    sessionId: FIXTURE_SESSION_ID,
    activeCommercialPeriodValueCents: FIXTURE_PERIOD_VALUE_CENTS,
  });

  assert.equal(revision, null);
});

test("canonical revision helper delegates to for_source wrapper in migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const forSourceStart = sql.indexOf("create or replace function public.commercial_plan_change_source_revision_for_source");
  const forSourceBody = sql.slice(forSourceStart, forSourceStart + 900);
  assert.match(forSourceBody, /e\.updated_at/);
  assert.match(forSourceBody, /s\.updated_at/);
  assert.match(forSourceBody, /e\.plan_key/);
  assert.match(forSourceBody, /p_active_commercial_period_value_cents/);
  assert.match(forSourceBody, /e\.id/);
  assert.match(forSourceBody, /s\.id/);
});
