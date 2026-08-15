import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../../app/api/instagram-dashboard/commercial/discovery/runs/route.ts");
const cron = read("../../app/api/cron/commercial-discovery/route.ts");
const processor = read("./discovery-processor.ts");
const reliability = read("./discovery-reliability.ts");
const migration = read("../../supabase/migrations/20260815003755_commercial_discovery_reliability_and_scale_gate_v1.sql");
const identityMigration = read("../../supabase/migrations/20260815024608_commercial_shared_platform_identity_guard_v1.sql");
const strongIdentityMigration = read("../../supabase/migrations/20260815031204_commercial_strong_identity_dedup_v1.sql");
const panel = read("../../app/instagram-dashboard/commercial/CommercialDiscoveryPanel.tsx");

test("owner route returns quickly and background processing is trusted and durable", () => {
  assert.match(route, /requireCommercialCrmAccess\(\)/);
  assert.match(route, /after\(\(\) => processCommercialDiscoveryBatch\(\)\)/);
  assert.match(route, /cancelCommercialDiscoveryRun/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(processor, /claim_commercial_discovery_runs_v2/);
  assert.match(processor, /claim_commercial_discovery_items_v2/);
  assert.match(migration, /for update of i skip locked/i);
  assert.doesNotMatch([route, cron, processor, panel].join("\n"), /sendEmail\(|sendDm\(|phoneFarm|queue_outreach|lead_approved/);
});

test("database plane is forced-RLS, service-role-only and cannot approve or contact", () => {
  for (const table of ["commercial_discovery_audit_events", "commercial_scoring_cache"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"));
  }
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /revoke all on function[\s\S]*from public,anon,authenticated;/i);
  assert.match(migration, /outreach_status[\s\S]*'not_started'/i);
  assert.doesNotMatch(migration, /qualification_status[^;]*'approved'/i);
});

test("precheck, evidence and audiences are deterministic before AI", () => {
  assert.match(processor, /deterministicCommercialPrecheck/);
  assert.ok(processor.indexOf("deterministicCommercialPrecheck") < processor.indexOf("await analyze"));
  assert.match(reliability, /PRECHECK_PASS/);
  assert.match(reliability, /PRECHECK_REJECT/);
  assert.match(reliability, /PRECHECK_AMBIGUOUS/);
  assert.match(processor, /deterministically_filtered_discovery_peers/);
  assert.match(reliability, /disallowedAudiencePattern/);
  assert.match(processor, /\.eq\("status", "completed"\)/);
  assert.match(processor, /\.not\("lead_id", "is", null\)/);
  assert.match(processor, /isSharedCommercialPlatformUrl/);
  assert.match(identityMigration, /commercial_crm_identity_domain_v2/);
  assert.match(identityMigration, /fresha\\\.com/);
  assert.match(strongIdentityMigration, /tiktok\\\.com/);
  assert.match(strongIdentityMigration, /first-party website domain/i);
  assert.doesNotMatch(strongIdentityMigration, /left\(regexp_replace\(lower\(business_name\)/i);
});

test("thirty-item execution cannot be one synchronous browser request", () => {
  assert.match(panel, /Controlled · 30/);
  assert.match(processor, /boundedCommercialBatchSize/);
  assert.match(processor, /boundedCommercialConcurrency/);
  assert.match(migration, /limit least\(greatest\(coalesce\(batch_limit, 5\), 1\), 5\)/i);
  assert.match(migration, /completed_with_errors/);
  assert.match(migration, /retry_scheduled/);
  assert.match(migration, /cancel_requested_at/);
});
