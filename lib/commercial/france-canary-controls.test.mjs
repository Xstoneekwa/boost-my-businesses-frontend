import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const migration = read("supabase/migrations/20261007204919_commercial_france_canary_controls_v1.sql");
const contract = read("lib/commercial/discovery-contract.ts");
const service = read("lib/commercial/discovery-service.ts");
const provider = read("lib/commercial/discovery-provider.ts");
const processor = read("lib/commercial/discovery-processor.ts");
const panel = read("app/instagram-dashboard/commercial/CommercialDiscoveryPanel.tsx");

test("France canary controls are parameterized and leave ZA gates intact", () => {
  assert.match(migration, /country_code = 'FR' and char_length\(btrim\(city\)\) between 1 and 120/);
  assert.match(migration, /country_code = 'ZA' and city in \('Johannesburg', 'Cape Town'\)/);
  assert.doesNotMatch(migration, /Paris|Marseille|Lyon/);
  assert.match(migration, /city = 'France'[\s\S]*max_prospects between 15 and 30[\s\S]*commercial-france-wide-sirene-poc15-v1/);
  assert.match(migration, /city <> 'France'[\s\S]*commercial-france-\[a-z0-9\]/);
  assert.match(contract, /countryCode\?: CommercialDiscoveryCountry/);
  assert.match(contract, /countryCode === "FR"/);
  assert.match(contract, /city === "France" \? 30 : 10/);
  assert.match(panel, /countryCode: market/);
});

test("identity claims are exact-first and soft matches remain review-only", () => {
  assert.match(migration, /commercial_france_identity_claims/);
  assert.match(migration, /unique \(key_type, key_value\)/i);
  assert.match(migration, /canonical_provider_identity/);
  assert.match(migration, /soft_identity_signal_requires_review/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /provider_external_id/);
  assert.doesNotMatch(migration, /similar_name|fuzzy|levenshtein/i);
});

test("budget ledger is provider-unit based and never invents unknown prices", () => {
  assert.match(migration, /commercial_france_provider_calls/);
  assert.match(migration, /cost_amount numeric\(14, 6\) null/);
  assert.match(migration, /cost_known/);
  assert.match(migration, /budget_exceeded/);
  assert.match(migration, /searchapi_discovery/);
  assert.match(migration, /openai_scoring/);
  assert.match(migration, /sirene/);
  assert.match(migration, /Null cost means provider price is unknown/i);
});

test("quality and safety breaker transitions are explicit and append-only", () => {
  assert.match(migration, /high_rate_min/);
  assert.match(migration, /medium_rate_max/);
  assert.match(migration, /provider_error_rate_max/);
  assert.match(migration, /duplicate_rate_max/);
  assert.match(migration, /latency_p95_max_ms/);
  assert.match(migration, /state=v_next/);
  assert.match(migration, /'stopped'/);
  assert.match(migration, /'hold'/);
  assert.doesNotMatch(migration, /delete from public\.commercial_(businesses|leads|discovery_items)/i);
  assert.doesNotMatch([service, provider, panel].join("\n"), /sendDm\(|sendEmail\(|phoneFarm|queue_outreach|lead_approved/);
});

test("worker claims stop when the France control plane is on HOLD or STOP", () => {
  assert.match(migration, /claim_commercial_discovery_runs_v2[\s\S]*state in \('hold', 'stopped', 'cancelled'\)/i);
  assert.match(migration, /claim_commercial_discovery_items_v2[\s\S]*state in \('hold', 'stopped', 'cancelled'\)/i);
});

test("France worker reserves discovery, profile, site and scoring units before provider work", () => {
  for (const kind of ["discovery", "profile", "site_page", "scoring"]) assert.match(processor, new RegExp(`\\"${kind}\\"`));
  assert.match(processor, /reserve_commercial_france_provider_call_v1/);
  assert.match(processor, /finish_commercial_france_provider_call_v1/);
  assert.match(processor, /evaluate_commercial_france_run_gate_v1/);
});
