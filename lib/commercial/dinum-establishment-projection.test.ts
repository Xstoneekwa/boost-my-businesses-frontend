import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { projectDinumEstablishment, type DinumProjectionContext } from "./dinum-establishment-projection";
import { projectFranceAdministrativeTerritory as territory } from "./france-administrative-territory";
import { admitProfileFirstAnchor, resolveProfileFirstIdentity } from "./profile-first-anchor";
import { COMMERCIAL_DISCOVERY_SUBSEGMENTS } from "./discovery-contract.ts";

// All administrative identities below are SYNTHETIC, not DINUM observations.
const at = "2026-10-19T12:00:00Z";
const context: DinumProjectionContext = { country: "FR", requestedCity: "Paris", businessName: "Atelier Fixture", observedAt: at,
  activityCompatibility: { code: "96.02A", nomenclature: "NAFRev2", compatible: true, ruleReference: "OFFLINE_APPROVED_RULE_FIXTURE_ONLY" } };
const establishment = () => ({ siret: "00123456700001", nom_commercial: "Atelier Fixture", liste_enseignes: ["Atelier Fixture"], adresse: "12 RUE EXEMPLE 75018 PARIS 18", code_postal: "75018", commune: "75118", libelle_commune: "PARIS 18", departement: "75", etat_administratif: "A", statut_diffusion_etablissement: "O", activite_principale: "96.02A", date_mise_a_jour_insee: "2026-10-01" });
const legalUnit = () => ({ siren: "001234567", nom_raison_sociale: "SOCIETE LEGALE FIXTURE", nom_complet: "SIEGE AUTRE VILLE", etat_administratif: "A", statut_diffusion: "O", date_mise_a_jour_insee: null, nombre_etablissements: 1, matching_etablissements: [establishment()], siege: { ...establishment(), nom_commercial: "DO NOT USE HEADQUARTERS" }, dirigeants: [{ nom: "DO_NOT_PERSIST", date_naissance: "DO_NOT_PERSIST" }], finances: { chiffre_affaires: "DO_NOT_PERSIST" } });
const payload = () => ({ page: 1, total_pages: 1, total_results: 1, results: [legalUnit()] });
const run = (p = payload(), c = context) => projectDinumEstablishment(p, c);
const setEst = (change: Record<string, unknown>) => { const p = payload(); Object.assign(p.results[0].matching_etablissements[0], change); return p; };
const anchorContext = { country: "FR" as const, requestedCity: "Paris", profileUrl: "https://instagram.com/fixture/", candidateWebsiteUrls: ["https://fixture.example/"] };

test("minimal DINUM projection preserves exact SIRET including zeroes and Sirene identity", () => {
  const r = run(); assert.equal(r.matchState, "UNIQUE_MATCH"); assert.equal(r.disposition, "ADMITTED");
  assert.equal(r.candidate?.provider, "sirene"); assert.equal(r.candidate?.externalId, "00123456700001");
  assert.equal(r.candidate?.city, "Paris"); assert.equal(r.candidate?.source.lineage?.rawAdminCity, "PARIS 18");
  assert.equal(r.candidate?.source.lineage?.delivery_source, "DINUM"); assert.equal(r.candidate?.source.lineage?.canonical_identity_provider, "sirene");
  assert.equal(r.candidate?.source.lineage?.providerUpdatedAt, "2026-10-01"); assert.equal(r.candidate?.source.lineage?.legalUnitUpdatedAt, null);
  assert.equal(r.candidate?.source.lineage?.observedAt, at); assert.equal(r.candidate?.source.lineage?.fieldPaths.siret, "results[0].matching_etablissements[0].siret");
});
test("allowlisted projection never contains periods, fake INSEE nesting, raw payload, finance or directors", () => {
  assert.doesNotMatch(JSON.stringify(run().candidate), /periodes|dateFin|uniteLegale|siege|nom_complet|dirigeants|finances|DO_NOT_PERSIST/);
  const source = readFileSync(new URL("./dinum-establishment-projection.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /normalizeSireneEstablishment\(|from ["']\.\/sirene-provider|fetch\(|\.rpc\(|process\.env|sendEmail|lookupInstagram/);
});
test("trade name priority: a different known commercial name cannot be bypassed by an enseigne", () => {
  assert.equal(run(setEst({ nom_commercial: "Different Atelier" })).matchState, "NO_MATCH");
  const r = run(setEst({ nom_commercial: null, liste_enseignes: ["Atelier Fixture", "Other Brand"] }));
  assert.equal(r.matchState, "UNIQUE_MATCH"); assert.equal(r.candidate?.businessName, "Atelier Fixture");
  assert.equal(r.candidate?.business_aliases?.find(a => a.alias_type === "legal_name")?.value, "SOCIETE LEGALE FIXTURE");
});
test("no legal or headquarters-name substitution, no fuzzy or generic-name certification", () => {
  assert.equal(run(setEst({ nom_commercial: null, liste_enseignes: [] })).disposition, "HOLD");
  assert.equal(run(setEst({ nom_commercial: "Atelier Ficture" })).matchState, "NO_MATCH");
  assert.equal(run(setEst({ nom_commercial: "Salon" }), { ...context, businessName: "Salon" }).disposition, "HOLD");
});
for (const siret of [123456700001, "0012345670000", "001234567000001", "0012345670000X", " 00123456700001"]) test(`exact string SIRET required (${String(siret)})`, () => {
  assert.equal(run(setEst({ siret })).candidate, null);
});
test("SIREN never merges establishments and must agree with exact SIRET", () => {
  const p = payload(); p.results[0].matching_etablissements.push({ ...establishment(), siret: "00123456700002" }); p.results[0].nombre_etablissements = 2;
  assert.equal(run(p).matchState, "AMBIGUOUS"); assert.equal(run(setEst({ siret: "99999999900001" })).matchState, "CONTRADICTION");
});
for (const [city, commune, postcode, department, expected] of [
  ["PARIS", "75056", "75018", "75", "Paris"], ["PARIS 18", "75118", "75018", "75", "Paris"],
  ["PARIS 16E ARRONDISSEMENT", "75116", "75116", "75", "Paris"], ["PARIS 16", "75116", "75016", "75", "Paris"],
  ["MARSEILLE", "13055", "13008", "13", "Marseille"], ["MARSEILLE 8", "13208", "13008", "13", "Marseille"],
  ["LYON", "69123", "69003", "69", "Lyon"], ["LYON 3E ARRONDISSEMENT", "69383", "69003", "69", "Lyon"],
  ["NANTES", "44109", "44000", "44", "NANTES"], ["SAINT-DENIS", "97411", "97400", "974", "SAINT-DENIS"],
  ["AJACCIO", "2A004", "20000", "2A", "AJACCIO"],
]) test(`official territorial projection ${city}/${commune}`, () => {
  const r = territory({ libelleCommune: city, commune, postalCode: postcode, department }); assert.equal(r.outcome, "PASS"); assert.equal(r.normalizedMatchCity, expected); assert.equal(r.rawAdminCity, city);
  const p = setEst({ libelle_commune: city, commune, code_postal: postcode, departement: department });
  assert.equal(run(p, { ...context, requestedCity: expected }).matchState, "UNIQUE_MATCH");
});
for (const change of [{ code_postal: "13018" }, { code_postal: "75017" }, { libelle_commune: "LYON" }, { departement: "13" }, { commune: "75117" }, { libelle_commune: "PARIS 21" }]) test(`territorial contradiction fails closed: ${JSON.stringify(change)}`, () => {
  assert.equal(run(setEst(change)).matchState, "CONTRADICTION"); assert.equal(run(setEst(change)).candidate, null);
});
test("requested city never becomes proof; missing city holds, different city contradicts", () => {
  assert.equal(run(setEst({ libelle_commune: null })).disposition, "HOLD");
  assert.equal(territory({ libelleCommune: "ND", commune: "44109", postalCode: "44000", department: "44" }).outcome, "HOLD");
  assert.equal(run(payload(), { ...context, requestedCity: "Marseille" }).matchState, "CONTRADICTION");
  const r = run(setEst({ libelle_commune: "  PARIS 18  " })); assert.equal(r.candidate?.source.lineage?.rawAdminCity, "  PARIS 18  ");
  assert.equal(run(payload(), { ...context, requestedCity: "France" }).candidate?.city, "Paris");
});
for (const field of ["statut_diffusion_etablissement", "etat_administratif"] as const) for (const value of [null, "P", "ND", "F"]) test(`${field}=${value} holds`, () => {
  assert.equal(run(setEst({ [field]: value })).disposition, "HOLD");
});
for (const field of ["statut_diffusion", "etat_administratif"] as const) for (const value of [null, "P", "ND", "C"]) test(`legal ${field}=${value} holds`, () => {
  const p = payload(); Object.assign(p.results[0], { [field]: value }); assert.equal(run(p).candidate, null);
});
test("missing/masked address or postcode and invalid provenance date hold", () => {
  for (const change of [{ adresse: "ND" }, { adresse: null }, { code_postal: null }, { date_mise_a_jour_insee: "invalid" }]) assert.equal(run(setEst(change)).disposition, "HOLD");
  assert.equal(run(payload(), { ...context, observedAt: "invalid" }).candidate, null);
});
test("first page bounded, incomplete search or establishment sets cannot prove uniqueness", () => {
  for (const change of [{ total_results: 2 }, { total_pages: 2 }, { page: 2 }, { total_pages: undefined }]) { const p = payload(); Object.assign(p, change); assert.equal(run(p).matchState, "AMBIGUOUS"); }
  const p = payload(); p.results[0].nombre_etablissements = 2; assert.equal(run(p).reason, "unexamined_legal_unit_establishments");
  assert.equal(projectDinumEstablishment({ page: 1, total_pages: 0, total_results: 0, results: [] }, context).matchState, "NO_MATCH");
});
test("unexamined plausible result prevents first-result selection, irrespective of order", () => {
  const p = payload(); p.results.push(legalUnit()); p.total_results = 2; Object.assign(p.results[1].matching_etablissements[0], { nom_commercial: null, liste_enseignes: [] });
  assert.equal(run(p).matchState, "AMBIGUOUS"); p.results.reverse(); assert.equal(run(p).matchState, "AMBIGUOUS");
});
test("same SIRET with contradictory fields never silently deduplicates", () => {
  const p = payload(); p.results.push(legalUnit()); p.total_results = 2; p.results[1].matching_etablissements[0].adresse = "23 AUTRE RUE PARIS";
  assert.equal(run(p).matchState, "CONTRADICTION");
});
test("raw activity retained; no invented all-niche matrix or POC restriction", () => {
  assert.equal(run().candidate?.activity.code, "96.02A");
  assert.equal(run(payload(), { ...context, activityCompatibility: undefined }).reason, "authorized_activity_compatibility_missing");
  assert.equal(run(payload(), { ...context, activityCompatibility: { ...context.activityCompatibility!, code: "86.90F" } }).candidate, null);
  // Injected approved-rule mock is not a newly authorized NAF mapping.
  const r = run(setEst({ activite_principale: "86.90F" }), { ...context, activityCompatibility: { code: "86.90F", nomenclature: "NAFRev2", compatible: true, ruleReference: "TEST_ONLY_NOT_A_LIVE_NAF_AUTHORIZATION" } });
  assert.equal(r.candidate?.activity.code, "86.90F");
  assert.equal(run(payload(), { ...context, observedAt: "2027-01-01T00:00:00Z" }).candidate, null);
  assert.deepEqual(COMMERCIAL_DISCOVERY_SUBSEGMENTS, ["Aesthetic Clinic", "Skin Clinic", "Med Spa", "Beauty Salon", "Hair Salon", "Hair Stylist", "Nail Studio", "Lash Studio", "Brow Studio", "Laser Clinic", "Makeup Artist", "Wellness Studio"]);
});
test("projection admits an independent anchor but cannot invent a website, Instagram proof or HIGH", () => {
  const r = run(); assert.ok(r.anchor); assert.equal(admitProfileFirstAnchor(r.anchor, anchorContext).outcome, "ADMITTED");
  assert.equal(r.candidate?.officialWebsite, undefined); assert.equal(r.candidate?.authorizedSocialLink, undefined);
  const identity = resolveProfileFirstIdentity({ anchors: [r.anchor], context: anchorContext, sites: [], profile: { url: anchorContext.profileUrl, observed_at: at }, observedAt: at });
  assert.equal(identity.scoringAllowed, false); assert.notEqual(identity.candidateIdentityConfidence, "HIGH");
});
test("adapter does not accept ZA and does not mutate input", () => {
  const p = payload(), snapshot = JSON.stringify(p); run(p); assert.equal(JSON.stringify(p), snapshot);
  assert.equal(run(p, { ...context, country: "ZA" } as unknown as DinumProjectionContext).candidate, null);
});
for (const handle of ["lemaitrebarbierparis", "mhaesthetic.clinic", "lashbyiava", "maisons_cils"]) test(`historical offline ${handle}: no fabricated DINUM match`, () => {
  // Empty synthetic DINUM response: historical observations are hints, not official matches.
  const r = projectDinumEstablishment({ page: 1, total_pages: 0, total_results: 0, results: [] }, { ...context, businessName: handle });
  assert.equal(r.matchState, "NO_MATCH"); assert.equal(r.candidate, null); assert.equal(r.anchor, null);
});
