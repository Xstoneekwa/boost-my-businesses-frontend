import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "../..");
const migrationPath = path.join(repositoryRoot, "supabase/migrations/20260730221713_ct_target_availability_global_shadow_runtime_v1.sql");
const migration = readFileSync(migrationPath, "utf8");
const ingestRoute = readFileSync(path.join(repositoryRoot, "app/api/internal/target-availability/ingest/route.ts"), "utf8");
const statusRoute = readFileSync(path.join(repositoryRoot, "app/api/internal/target-availability/status/route.ts"), "utf8");
const pipeline = readFileSync(path.join(moduleRoot, "runtime-pipeline.ts"), "utf8");

test("migration is additive, dormant and service-role-only", () => {
  assert.match(migration, /capture_enabled boolean not null default false/);
  assert.match(migration, /scope_mode text not null default 'off'/);
  assert.match(migration, /human_reenable_required boolean not null default false/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all(?: privileges)? on .* from public,\s*anon,\s*authenticated/i);
  assert.match(migration, /grant .* to service_role/i);
  assert.doesNotMatch(migration, /\b(?:update|delete from|truncate)\s+public\.ig_targets\b/i);
  assert.doesNotMatch(migration, /\b(?:insert into|update|delete from)\s+public\.(?:ct_target_lifecycle|notifications|client_email)/i);
});

test("ingest and status surfaces are private and dynamic", () => {
  for (const source of [ingestRoute, statusRoute]) {
    assert.match(source, /targetAvailabilityPrivateRequestAuthorized/);
    assert.match(source, /force-dynamic/);
  }
  assert.match(ingestRoute, /processTargetAvailabilityBatch/);
  assert.doesNotMatch(ingestRoute, /sendEmail|notification|replacement|archive/i);
});

test("pipeline has canonical scope, caps, leases, persistence and auto-kill", () => {
  assert.match(pipeline, /client_instagram_accounts/);
  assert.match(pipeline, /claim_target_availability_observation_capacity_v1/);
  assert.match(pipeline, /claim_target_availability_pipeline_lease_v1/);
  assert.match(pipeline, /persist_target_availability_pipeline_v1/);
  assert.match(migration, /return jsonb_build_object\([\s\S]*?'outcome','failed'/);
  assert.match(pipeline, /persisted\.data\?\.outcome\) === "failed"/);
  assert.match(pipeline, /trigger_target_availability_auto_kill_v1/);
  assert.doesNotMatch(pipeline, /target-lifecycle|ct-premium|sendEmail|notification/i);
});
