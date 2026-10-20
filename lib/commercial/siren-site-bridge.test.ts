import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { projectDinumEstablishment, type DinumProjectionContext } from "./dinum-establishment-projection";
import { SIREN_SITE_BRIDGE_CONTRACT, validateFirstPartySirenEvidence, type FirstPartySirenEvidence } from "./siren-site-bridge";
import { admitProfileFirstAnchor, resolveProfileFirstIdentity } from "./profile-first-anchor";

// Synthetic observations only. These are not live DINUM/company claims.
const at = "2026-10-19T20:00:00Z";
const evidence = (): FirstPartySirenEvidence => ({
  instagram: { profileUrl: "https://www.instagram.com/atelier_fixture/", linkedWebsiteUrl: "http://atelier.example/", linkField: "external_url", sourceReference: "commercial-item:fixture:instagram.external_url", observedAt: at },
  site: { url: "https://atelier.example/", legalPageUrl: "https://atelier.example/mentions-legales", kind: "LEGAL_PAGE", observedAt: at,
    siren: "001234567", legalName: "Atelier Fixture", address: "12 rue Exemple, 75018 Paris", postalCode: "75018", city: "Paris" }, contradictions: [],
});
const est = () => ({ siret: "00123456700001", nom_commercial: null, liste_enseignes: null, adresse: "12 RUE EXEMPLE 75018 PARIS", code_postal: "75018", commune: "75118", libelle_commune: "PARIS", etat_administratif: "A", statut_diffusion_etablissement: "O", activite_principale: "96.02A" });
const payload = () => ({ page: 1, total_pages: 1, total_results: 1, results: [{ siren: "001234567", nom_raison_sociale: null, etat_administratif: "A", statut_diffusion: "O", nombre_etablissements: 1, matching_etablissements: [est()] }] });
const context = (): DinumProjectionContext => ({ country: "FR", requestedCity: "Paris", businessName: "Atelier Fixture", observedAt: at,
  activityCompatibility: { code: "96.02A", nomenclature: "NAFRev2", compatible: true, ruleReference: "EXISTING_AUTHORIZED_POLICY_FIXTURE" }, legalUnitBridge: evidence() });
const run = (p = payload(), c = context()) => projectDinumEstablishment(p, c);
const identity = (strong = false) => {
  const r = run(); assert.ok(r.anchor);
  const e = evidence(), profileUrl = e.instagram.profileUrl;
  return resolveProfileFirstIdentity({ anchors: [r.anchor], context: { country: "FR", requestedCity: "Paris", profileUrl, candidateWebsiteUrls: [e.site.url] },
    sites: [{ url: e.site.legalPageUrl, text: `${e.site.legalName} ${e.site.address}`, links: strong ? [profileUrl] : [] }],
    profile: { url: profileUrl, alias: "Atelier Fixture", city: "Paris", website: e.instagram.linkedWebsiteUrl, observed_at: at }, observedAt: at });
};

test("exact first-party SIREN plus unique independently confirmed local SIRET admits", () => {
  const r = run(); assert.equal(r.disposition, "ADMITTED"); assert.equal(r.matchState, "UNIQUE_MATCH");
  assert.equal(r.candidate?.provider, "sirene"); assert.equal(r.candidate?.externalId, "00123456700001");
  assert.equal(r.candidate?.address, "12 RUE EXEMPLE 75018 PARIS");
  assert.equal(r.candidate?.source.lineage?.legalIdentityBridge?.contract, SIREN_SITE_BRIDGE_CONTRACT);
  assert.equal(r.candidate?.source.lineage?.legalIdentityBridge?.uniqueEstablishment, true);
});
test("site legal name remains honestly first-party sourced when DINUM local/legal names are absent", () => {
  const c = run().candidate!; assert.equal(c.businessName, "Atelier Fixture");
  assert.equal(c.source.lineage?.legalIdentityBridge?.nameOrigin, "FIRST_PARTY_LEGAL_PAGE");
  assert.deepEqual(c.business_aliases?.map(a => [a.provider, a.alias_type, a.evidence]), [["first_party_site", "legal_name", evidence().site.legalPageUrl]]);
  assert.equal(c.source.lineage?.fieldPaths["legalUnit.nom_raison_sociale"], "results[0].nom_raison_sociale");
});
test("without explicit bridge, original missing trade-name HOLD remains unchanged", () => {
  const c = context(); delete c.legalUnitBridge;
  assert.equal(run(payload(), c).reason, "local_trade_name_missing_or_unmatched");
});
test("multiple matching active establishments HOLD; reversing order changes nothing", () => {
  const p = payload(); p.results[0].matching_etablissements.push({ ...est(), siret: "00123456700002" }); p.results[0].nombre_etablissements = 2;
  for (let i = 0; i < 2; i++) { const r = run(p); assert.equal(r.reason, "multiple_admissible_sirets"); assert.equal(r.anchor, null); p.results[0].matching_etablissements.reverse(); }
});
test("SIREN never selects first establishment or headquarters; one exact local match may coexist with another address", () => {
  const p = payload(); p.results[0].matching_etablissements.unshift({ ...est(), siret: "00123456700002", adresse: "14 RUE EXEMPLE 75018 PARIS" }); p.results[0].nombre_etablissements = 2;
  Object.assign(p.results[0], { siege: { ...est(), siret: "00123456700002" } });
  assert.equal(run(p).candidate?.externalId, "00123456700001");
});
test("same SIRET with conflicting observations cannot conceal an inconsistent second address", () => {
  const p = payload(); p.results[0].matching_etablissements.push({ ...est(), adresse: "14 RUE EXEMPLE 75018 PARIS" }); p.results[0].nombre_etablissements = 2;
  assert.equal(run(p).reason, "same_siret_conflicting_observations");
});
test("identical duplicate observations remain one exact SIRET, not a SIREN merge", () => {
  const p = payload(); p.results[0].matching_etablissements.push(est()); p.results[0].nombre_etablissements = 2;
  assert.equal(run(p).candidate?.externalId, "00123456700001");
});
for (const address of ["14 RUE EXEMPLE 75018 PARIS", "12 RUE EXAMPL 75018 PARIS", "12 R. EXEMPLE 75018 PARIS", "1-2 RUE EXEMPLE 75018 PARIS"]) test(`no fuzzy or invented abbreviation: ${address}`, () => {
  const p = payload(); p.results[0].matching_etablissements[0].adresse = address;
  assert.equal(run(p).anchor, null); assert.equal(run(p).reason, "site_establishment_address_not_confirmed");
});
test("only existing deterministic case/accents/separator normalization is used", () => {
  const c = context(); c.legalUnitBridge!.site.address = "12 rué Exemple,   75018 PARIS";
  assert.equal(run(payload(), c).disposition, "ADMITTED");
});
for (const field of ["siren", "postalCode", "city", "address", "legalName"] as const) test(`missing site ${field} => HOLD`, () => {
  const c = context(); c.legalUnitBridge!.site[field] = "";
  assert.equal(run(payload(), c).disposition, "HOLD"); assert.equal(run(payload(), c).anchor, null);
});
test("postcode/city without street detail does not become an establishment address", () => {
  const c = context(); c.legalUnitBridge!.site.address = "75018 Paris"; assert.equal(run(payload(), c).reason, "precise_observed_site_address_required");
});
for (const domain of ["wa.me", "t.me", "iarabeauty.com", "planity.com", "linktr.ee"]) test(`${domain} SIREN is not a first-party bridge`, () => {
  const c = context(), e = c.legalUnitBridge!;
  e.instagram.linkedWebsiteUrl = e.site.url = `https://${domain}/fixture`; e.site.legalPageUrl = `https://${domain}/legal`;
  assert.equal(run(payload(), c).reason, "direct_first_party_domain_required");
});
test("missing/indirect Instagram provenance or different domain holds", () => {
  for (const mutate of [(e: FirstPartySirenEvidence) => { e.instagram.sourceReference = ""; }, (e: FirstPartySirenEvidence) => { e.instagram.profileUrl = "https://instagram.com/p/fixture/"; }, (e: FirstPartySirenEvidence) => { e.instagram.linkedWebsiteUrl = "https://different.example/"; }, (e: FirstPartySirenEvidence) => { e.site.legalPageUrl = "https://different.example/legal"; }]) {
    const c = context(); mutate(c.legalUnitBridge!); assert.equal(run(payload(), c).anchor, null);
  }
});
test("explicit contradiction blocks admission; an observed legal-name contradiction is not ignored", () => {
  const c = context(); c.legalUnitBridge!.contradictions.push("observed conflicting business identity"); assert.equal(run(payload(), c).reason, "strong_identity_contradiction");
  const p = payload(); Object.assign(p.results[0], { nom_raison_sociale: "A DIFFERENT LEGAL UNIT NAME" }); assert.equal(run(p).matchState, "CONTRADICTION");
});
test("SIREN is not synthesized into SIRET and numeric identifiers are refused", () => {
  for (const siret of ["001234567", "0012345670000", "99999999900001", 123456700001]) {
    const p = payload(); Object.assign(p.results[0].matching_etablissements[0], { siret }); assert.equal(run(p).anchor, null);
  }
});
test("same address with different exact SIREN is insufficient, blocking address-only circular admission", () => {
  const c = context(); c.legalUnitBridge!.site.siren = "009999999"; assert.equal(run(payload(), c).reason, "site_siren_not_confirmed_by_registry");
});
for (const change of [{ etat_administratif: "F" }, { statut_diffusion_etablissement: "P" }]) test(`establishment eligibility unchanged ${JSON.stringify(change)}`, () => {
  const p = payload(); Object.assign(p.results[0].matching_etablissements[0], change); assert.equal(run(p).anchor, null);
});
for (const change of [{ etat_administratif: "C" }, { statut_diffusion: "P" }]) test(`legal-unit eligibility unchanged ${JSON.stringify(change)}`, () => {
  const p = payload(); Object.assign(p.results[0], change); assert.equal(run(p).anchor, null);
});
test("incomplete, paginated or unexamined sets never prove uniqueness", () => {
  for (const change of [{ total_results: 2 }, { total_pages: 2 }, { page: 2 }]) { const p = payload(); Object.assign(p, change); assert.equal(run(p).anchor, null); }
  const p = payload(); p.results[0].nombre_etablissements = 2; assert.equal(run(p).reason, "unexamined_legal_unit_establishments");
});
test("unknown activity policy still HOLD; ZA remains outside the France-only adapter", () => {
  const c = context(); delete c.activityCompatibility; assert.equal(run(payload(), c).reason, "authorized_activity_compatibility_missing");
  assert.equal(run(payload(), { ...context(), country: "ZA" } as unknown as DinumProjectionContext).reason, "invalid_projection_context");
});
test("admission is not HIGH: no observed reverse site link/profile address means V2 remains MEDIUM", () => {
  const r = identity(); assert.equal(r.admission.outcome, "ADMITTED");
  assert.equal(r.identity?.match.resolverVersion, "COMMERCIAL_INSTAGRAM_RESOLVER_V2");
  assert.equal(r.candidateIdentityConfidence, "MEDIUM"); assert.equal(r.scoringAllowed, false);
});
test("existing V2 alone may return HIGH if synthetic strong same-account evidence actually exists", () => {
  const r = identity(true); assert.equal(r.candidateIdentityConfidence, "HIGH"); assert.equal(r.scoringAllowed, true);
});
test("a profile-bound SIREN bridge cannot admit another Instagram account", () => {
  const r = run(); assert.ok(r.anchor);
  const a = admitProfileFirstAnchor(r.anchor, { country: "FR", requestedCity: "Paris", profileUrl: "https://instagram.com/another_fixture/", candidateWebsiteUrls: [evidence().site.url] });
  assert.equal(a.outcome, "HOLD"); if (a.outcome === "HOLD") assert.equal(a.detail, "legal_bridge_bound_to_another_instagram_profile");
});
test("missing first-party SIREN remains HOLD for the three other historical profiles, no expansion of handles", () => {
  for (const handle of ["mhaesthetic.clinic", "lashbyiava", "maisons_cils"]) {
    const e = evidence(); e.instagram.profileUrl = `https://instagram.com/${handle}/`; e.site.siren = "";
    assert.notEqual(validateFirstPartySirenEvidence(e), null);
  }
});
test("new helper is pure, has no provider/DB/scoring/transport activation and preserves input", () => {
  const p = payload(), c = context(), before = JSON.stringify([p, c]); run(p, c); assert.equal(JSON.stringify([p, c]), before);
  const source = readFileSync(new URL("./siren-site-bridge.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|\.rpc\(|process\.env|lookupInstagram|analyzeCommercial|sendEmail/);
  assert.equal(run().candidate?.officialWebsite, undefined); assert.equal(run().candidate?.authorizedSocialLink, undefined);
});
