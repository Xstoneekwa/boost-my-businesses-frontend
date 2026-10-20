import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { COMMERCIAL_DISCOVERY_SUBSEGMENTS, type CommercialDiscoverySubsegment } from "./discovery-contract.ts";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio.ts";

// Expected local-language primary mapping, not a second production niche list.
const expected: Record<CommercialDiscoverySubsegment, string> = {
  "Aesthetic Clinic": "clinique esthétique", "Skin Clinic": "soins de la peau", "Med Spa": "médecine esthétique",
  "Beauty Salon": "institut de beauté", "Hair Salon": "salon de coiffure", "Hair Stylist": "coiffeur",
  "Nail Studio": "onglerie", "Lash Studio": "extensions de cils", "Brow Studio": "sourcils",
  "Laser Clinic": "épilation laser", "Makeup Artist": "maquilleuse", "Wellness Studio": "spa",
};
for (const city of ["Paris", "Marseille", "Lyon", "Annecy"]) {
  for (const subsegment of COMMERCIAL_DISCOVERY_SUBSEGMENTS) test(`broad ${city}: ${subsegment} explicitly covered`, () => {
    const queries = buildCommercialDiscoveryQueries(city, null, "FR");
    assert.equal(queries.length, COMMERCIAL_DISCOVERY_SUBSEGMENTS.length);
    assert.equal(new Set(queries).size, 12);
    const index = COMMERCIAL_DISCOVERY_SUBSEGMENTS.indexOf(subsegment);
    assert.ok(queries[index].includes(`"${expected[subsegment]}"`));
    assert.ok(queries[index].includes(`"${city}" France`));
    assert.ok(buildCommercialDiscoveryQueries(city, subsegment, "FR").includes(queries[index]));
  });
  test(`broad ${city}: null/undefined normalization and generic locality`, () => {
    const queries = buildCommercialDiscoveryQueries(city, null, "FR");
    assert.deepEqual(queries, buildCommercialDiscoveryQueries(city, undefined, "FR"));
    assert.ok(queries.every(q => q.includes('-inurl:/p/') && q.includes('-inurl:/reel/') && q.includes('-inurl:/privacy/')));
    if (city !== "Paris") assert.ok(queries.every(q => !q.includes('"Paris"')));
  });
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
test("targeted FR query outputs byte-identical to certified bb6ed662 baseline", () => {
  assert.equal(hash(["Paris", "Marseille", "Lyon", "Annecy"].map(city => COMMERCIAL_DISCOVERY_SUBSEGMENTS.map(n => buildCommercialDiscoveryQueries(city, n, "FR")))),
    "05290cc59dd22108299e477ba017575402db7b912caec5fb5dbf9a97fd7bbf97");
});
test("ZA broad and all twelve targeted modes byte-identical to baseline", () => {
  assert.equal(hash(["Johannesburg", "Cape Town"].map(city => [buildCommercialDiscoveryQueries(city, undefined, "ZA"), ...COMMERCIAL_DISCOVERY_SUBSEGMENTS.map(n => buildCommercialDiscoveryQueries(city, n, "ZA"))])),
    "6c2b4e0aedfbe1f73fab8fd48fecf393356420088b89f3a4fbf493fe4d43d3d7");
});
test("historical national France scope remains separate and byte-identical", () => {
  assert.equal(hash(buildCommercialDiscoveryQueries("France", undefined, "FR")), "c3b8c12ef5d6eb8a12edae96ce57545e1f0c9193162c4c5c19dc9676ff2053fa");
});
test("canonical collection drives broad enumeration; no parallel incomplete broad list", () => {
  const source = readFileSync(new URL("./discovery-query-portfolio.ts", import.meta.url), "utf8");
  assert.match(source, /COMMERCIAL_DISCOVERY_SUBSEGMENTS\.map\(segment => base\(FRANCE_SUBSEGMENT_TERMS\[segment\]\[0\]\)\)/);
  assert.doesNotMatch(source, /FRANCE_BROAD_TERMS/);
  assert.equal(Object.keys(expected).length, COMMERCIAL_DISCOVERY_SUBSEGMENTS.length);
});
