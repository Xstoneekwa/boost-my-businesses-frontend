import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../../app/api/instagram-dashboard/commercial/discovery/runs/route.ts");
const service = read("./discovery-service.ts");
const migration = read("../../supabase/migrations/20260814233231_commercial_discovery_enrichment_ai_scoring_v1.sql");
const panel = read("../../app/instagram-dashboard/commercial/CommercialDiscoveryPanel.tsx");

test("route and service are owner gated and the production endpoint is canary locked", () => {
  assert.match(route, /requireCommercialCrmAccess\(\)/); assert.match(service, /requireCommercialCrmAccess\(\)/);
  assert.match(route, /COMMERCIAL_DISCOVERY_CANARY_MAX/); assert.match(panel, /maxProspects: 3/);
  assert.doesNotMatch([route, service, panel].join("\n"), /sendEmail\(|sendDm\(|phoneFarm|queue_outreach|lead_approved/);
});

test("database plane is forced-RLS, service-role-only and cannot approve or contact", () => {
  for (const table of ["commercial_discovery_runs", "commercial_discovery_items", "commercial_business_identifiers"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"));
  }
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /outreach_status[\s\S]*'not_started'/i);
  assert.doesNotMatch(migration, /qualification_status[^;]*'approved'/i);
});

test("audience suggestions are sourced from verified discovery peers", () => {
  assert.match(service, /source: "verified_discovery_peers"/);
  assert.match(service, /profile_url: candidate\.profileUrl/);
  assert.doesNotMatch(service, /ig_targets|ct_target|account_targets/);
});
