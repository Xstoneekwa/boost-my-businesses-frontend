import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveCommercialLocation, deterministicCommercialPrecheck } from "./discovery-reliability.ts";
import { resolveFranceLocation } from "./france-location.ts";

// Same explicit-location contract fixture used to reproduce Paris V4.
const parisEvidence = { instagram: ["Paris, France"], provider: ["Paris, France"] };

for (const city of ["Paris", "Marseille", "Lyon", "Annecy", "Saint-Rémy-de-Provence"]) {
  test(`FR market routes ${city} through the unchanged France resolver`, () => {
    const signals = city === "Paris" ? parisEvidence : { instagram: [`${city}, France`], provider: [`${city}, France`] };
    const location = resolveCommercialLocation({ countryCode: "FR", requestedCity: city, signals });
    assert.deepEqual(location, resolveFranceLocation(signals));
    assert.equal(location.country, "FR");
    assert.equal(location.city, city);
    assert.equal(location.confidence, "HIGH");
    assert.equal(deterministicCommercialPrecheck({ countryCode: "FR", requestedCity: city, profileName: "Institut esthétique", location }).decision, "PRECHECK_PASS");
  });
}

test("nationwide France and legacy nationwide callers remain identical", () => {
  const expected = resolveFranceLocation(parisEvidence);
  assert.deepEqual(resolveCommercialLocation({ countryCode: "FR", requestedCity: "France", signals: parisEvidence }), expected);
  assert.deepEqual(resolveCommercialLocation({ requestedCity: "France", signals: parisEvidence }), expected);
});

test("requested Paris never accepts a proven establishment in another French city", () => {
  const signals = { instagram: ["Lyon, France"], provider: ["Lyon, France"] };
  const location = resolveCommercialLocation({ countryCode: "FR", requestedCity: "Paris", signals });
  assert.deepEqual(location, resolveFranceLocation(signals)); // No confidence/threshold rewrite.
  assert.equal(location.city, "Lyon");
  assert.equal(deterministicCommercialPrecheck({ countryCode: "FR", requestedCity: "Paris", profileName: "Institut esthétique", location }).reason, "outside_strict_market");
  assert.equal(deterministicCommercialPrecheck({ countryCode: "FR", requestedCity: "France", profileName: "Institut esthétique", location }).decision, "PRECHECK_PASS");
});

test("city constraint is case/whitespace insensitive without changing observed evidence", () => {
  const location = resolveCommercialLocation({ countryCode: "FR", requestedCity: " paris ", signals: parisEvidence });
  assert.equal(location.city, "Paris");
  assert.equal(deterministicCommercialPrecheck({ countryCode: "FR", requestedCity: " paris ", profileName: "Institut esthétique", location }).decision, "PRECHECK_PASS");
});

test("missing, foreign or conflicting evidence stays unresolved; a requested city is not proof", () => {
  for (const signals of [{}, { instagram: ["Paris"] }, { instagram: ["Paris, Canada"] }, { instagram: ["Paris, France"], website: ["Lyon, France"] }]) {
    const location = resolveCommercialLocation({ countryCode: "FR", requestedCity: "Paris", signals });
    assert.deepEqual(location, resolveFranceLocation(signals));
    assert.equal(location.confidence, "LOW");
    assert.equal(deterministicCommercialPrecheck({ countryCode: "FR", requestedCity: "Paris", profileName: "Institut esthétique", location }).decision, "PRECHECK_AMBIGUOUS");
  }
});

test("existing France precheck exclusions apply to explicit cities, unchanged", () => {
  const location = resolveFranceLocation(parisEvidence);
  assert.equal(deterministicCommercialPrecheck({ countryCode: "FR", requestedCity: "Paris", profileName: "CIME - Collège International de Médecine Esthétique", biography: "Formations certifiées QUALIOPI", location }).reason, "fr_training_only_organization");
});

test("ZA country uses exactly its historical resolution and precheck behavior", () => {
  for (const city of ["Johannesburg", "Cape Town"]) {
    const signals = { instagram: [`Hair salon ${city}`], provider: [`Beauty ${city}`] };
    const legacy = resolveCommercialLocation({ requestedCity: city, signals });
    const explicit = resolveCommercialLocation({ countryCode: "ZA", requestedCity: city, signals });
    assert.deepEqual(explicit, legacy);
    assert.deepEqual(deterministicCommercialPrecheck({ countryCode: "ZA", requestedCity: city, profileName: "Beauty salon", location: explicit }), deterministicCommercialPrecheck({ requestedCity: city, profileName: "Beauty salon", location: legacy }));
  }
  assert.equal(resolveCommercialLocation({ countryCode: "ZA", requestedCity: "France", signals: parisEvidence }).country, null);
});

test("all worker geography branches receive canonical country, including missing-profile and audience paths", () => {
  const processor = readFileSync(new URL("./discovery-processor.ts", import.meta.url), "utf8");
  assert.match(processor, /select\("country_code"\)\.eq\("id", text\(item.run_id\)\)/);
  assert.doesNotMatch(processor, /!\["Johannesburg", "Cape Town"\]\.includes\(city\)/);
  const calls = processor.match(/(?:resolveCommercialLocation|deterministicCommercialPrecheck)\(\{[^\n]+/g) ?? [];
  assert.equal(calls.length, 9); // Includes the independent-anchor location/precheck pair.
  assert.ok(calls.every((call) => /countryCode(?:: market)?[,}]/.test(call)));
});
