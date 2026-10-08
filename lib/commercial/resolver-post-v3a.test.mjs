import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const service = readFileSync(new URL("./resolver-post-v3a-service.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/instagram-dashboard/commercial/discovery/resolver-post-v3a/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20261007195920_commercial_resolver_post_v3a_targeted_v1.sql", import.meta.url), "utf8");

test("post-V3A route has a distinct owner-only idempotency key", () => {
  assert.match(service, /commercial-resolver-v2-post-v3a-targeted-v1/);
  assert.match(route, /RESOLVER_POST_V3A_KEY/);
  assert.match(route, /startResolverPostV3A/);
});

test("execution boundary is exactly the four fixed V3A targets", () => {
  assert.match(service, /inputs\.length !== SIRENE_ALIAS_TARGETS\.length/);
  assert.match(service, /resolver_post_v3a_target_not_authorized/);
  assert.match(migration, /post_v3a_exact_four_required/);
  assert.match(migration, /'05580205200039','10000706100011','10001008100014','10001013100025'/);
  assert.doesNotMatch(service, /resolver-reprocess-service/);
});

test("historical V2 is immutable and no commercial side effects are wired", () => {
  assert.match(migration, /historicalResolverV2Immutable/);
  assert.match(migration, /resolver_v2_post_v3a/);
  assert.doesNotMatch(migration, /jsonb_set\(summary,'\{resolver_v2\}'/);
  assert.doesNotMatch(service, /SireneProvider|discovery-ai|discovery-scoring|create_structured_commercial|sendEmail|commercial_leads|commercial_outreach/);
  assert.match(migration, /business_aliases/);
  assert.match(migration, /v3aAliases/);
});

test("V2 confidence rules and append-only result guards remain enforced", () => {
  assert.match(migration, /confidence}'='MEDIUM'/);
  assert.match(migration, /not \(i\.enrichment_snapshot_safe \? 'resolver_v2_post_v3a'\)/);
  assert.match(migration, /not i\.selected_for_processing/);
  assert.match(migration, /i\.lead_id is null/);
  assert.match(service, /enforceChainSafety/);
});
