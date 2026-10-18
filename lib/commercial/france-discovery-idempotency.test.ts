import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildCommercialFranceDiscoveryIdempotencyKey, COMMERCIAL_FRANCE_RUN_KEY_PATTERN, parseCommercialDiscoveryTrigger } from "./discovery-contract.ts";
import { FRANCE_CANARY_IDEMPOTENCY_KEY } from "./market-config.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20261007204919_commercial_france_canary_controls_v1.sql", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../app/instagram-dashboard/commercial/CommercialDiscoveryPanel.tsx", import.meta.url), "utf8");

for (const city of ["Paris", "Marseille", "Lyon", "Cournon-d’Auvergne"]) {
  test(`${city} 10 + null generates a V2 key accepted by the unchanged France contract`, async () => {
    const input = { city, maxProspects: 10, subsegment: null };
    const key = await buildCommercialFranceDiscoveryIdempotencyKey(input);
    assert.match(key, COMMERCIAL_FRANCE_RUN_KEY_PATTERN);
    assert.ok(key.endsWith("-v2"));
    assert.ok(key.length <= 200);
    const parsed = parseCommercialDiscoveryTrigger({ ...input, countryCode: "FR", idempotencyKey: key });
    assert.equal(parsed.city, city);
    assert.equal(parsed.maxProspects, 10);
    assert.equal(parsed.subsegment, undefined);
    assert.equal(key, await buildCommercialFranceDiscoveryIdempotencyKey(input));
  });
}

test("identical parameters replay the same key across calls, including null/omitted subsegment", async () => {
  const key = await buildCommercialFranceDiscoveryIdempotencyKey({ city: "Paris", maxProspects: 10, subsegment: null });
  assert.equal(key, await buildCommercialFranceDiscoveryIdempotencyKey({ city: "Paris", maxProspects: 10 }));
  assert.equal(key, await buildCommercialFranceDiscoveryIdempotencyKey({ city: " Paris ", maxProspects: 10 }));
});

test("city, volume and subsegment scope changes produce different keys", async () => {
  const inputs = [
    { city: "Paris", maxProspects: 10 },
    { city: "Marseille", maxProspects: 10 },
    { city: "Paris", maxProspects: 30 },
    { city: "Paris", maxProspects: 10, subsegment: "Hair Salon" as const },
  ];
  const keys = await Promise.all(inputs.map(buildCommercialFranceDiscoveryIdempotencyKey));
  assert.equal(new Set(keys).size, inputs.length);
});

test("slug collisions and long generic France city strings cannot collapse the run scope", async () => {
  const first = await buildCommercialFranceDiscoveryIdempotencyKey({ city: "Saint-Remy", maxProspects: 10 });
  const second = await buildCommercialFranceDiscoveryIdempotencyKey({ city: "Saint Remy", maxProspects: 10 });
  assert.notEqual(first, second);
  const long = await buildCommercialFranceDiscoveryIdempotencyKey({ city: "é".repeat(120), maxProspects: 10 });
  assert.match(long, COMMERCIAL_FRANCE_RUN_KEY_PATTERN);
  assert.ok(long.length <= 200);
});

test("old discovery UUID namespace is refused only for new France city runs", () => {
  const old = "commercial-discovery:00000000-0000-4000-8000-000000000000";
  assert.equal(COMMERCIAL_FRANCE_RUN_KEY_PATTERN.test(old), false);
  assert.throws(() => parseCommercialDiscoveryTrigger({ countryCode: "FR", city: "Paris", maxProspects: 10, subsegment: null, idempotencyKey: old }), /commercial_france_idempotency_key_invalid/);
  assert.equal(parseCommercialDiscoveryTrigger({ countryCode: "ZA", city: "Johannesburg", maxProspects: 10, idempotencyKey: old }).idempotencyKey, old);
  assert.match(panel, /market === "FR" \? String\(formData\.get\("idempotencyKey"\) \|\| ""\) : `commercial-discovery:\$\{crypto\.randomUUID\(\)\}`/);
});

test("historical nationwide France run still uses its existing canonical key", async () => {
  assert.equal(await buildCommercialFranceDiscoveryIdempotencyKey({ city: "France", maxProspects: 30 }), FRANCE_CANARY_IDEMPOTENCY_KEY);
  assert.equal(parseCommercialDiscoveryTrigger({ city: "France", maxProspects: 30, idempotencyKey: "historical-compatible" }).city, "France");
});

test("builder and parser use exactly the existing DB namespace without changing RPC", () => {
  const dbPattern = "^commercial-france-[a-z0-9][a-z0-9-]{1,180}-v[0-9]+$";
  assert.ok(migration.includes(dbPattern));
  assert.equal(COMMERCIAL_FRANCE_RUN_KEY_PATTERN.source, dbPattern);
});

test("form prepares the same key it submits and retains the Content-Type guard", () => {
  assert.match(panel, /buildCommercialFranceDiscoveryIdempotencyKey\(\{ city: franceCity, maxProspects: franceVolume, subsegment: null \}\)/);
  assert.match(panel, /type="hidden" name="idempotencyKey" value=\{franceKey\}/);
  assert.match(panel, /<output aria-label="France run reference"[^>]*>\{franceKey \|\|/);
  assert.match(panel, /market === "FR" && !franceKey/);
  assert.match(panel, /forceRescore: false, idempotencyKey \}/);
  assert.match(panel, /contentType\.toLowerCase\(\)\.includes\("application\/json"\)/);
  assert.match(panel, /await readApiPayload\(response\)/);
});
