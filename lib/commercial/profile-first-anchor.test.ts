import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { admitProfileFirstAnchor, anchorsFromStructuredBusinesses, classifyProfileFirstWebsiteUrl, resolveProfileFirstIdentity, type EstablishmentAnchor, type AnchorContext } from "./profile-first-anchor";
import { CommercialOfficialWebsiteResolver } from "./business-resolution-v2";
import { enrichCommercialWebsite, extractFranceCaptionDomainHints, extractObservedUrls, resolveCommercialLocation } from "./discovery-reliability.ts";
import { COMMERCIAL_DISCOVERY_SUBSEGMENTS } from "./discovery-contract.ts";

const at = "2026-10-19T15:00:00Z";
const context: AnchorContext = { country: "FR", requestedCity: "Paris", profileUrl: "https://www.instagram.com/salon_fixture/", candidateWebsiteUrls: ["https://salon.example/"] };
const anchor: EstablishmentAnchor = {
  candidate: { provider: "authorized_registry_fixture", externalId: "EST-1", businessName: "Salon Fixture", country: "FR", city: "Paris", address: "12 rue Exemple", postalCode: "75018", department: "75",
    activity: { code: "", nomenclature: "", label: "Beauty & Aesthetics" }, eligibility: { prospectingEligible: true, reason: "existing_policy", checkedAt: at, policyVersion: "existing", establishmentDiffusion: "O", legalUnitDiffusion: "O" },
    source: { url: "https://registry.example/establishment/EST-1", license: "fixture", attribution: "Authorized registry fixture", observedAt: at } },
  provenance: { kind: "STRUCTURED_ESTABLISHMENT", provider: "authorized_registry_fixture", reference: "https://registry.example/establishment/EST-1", observedAt: at, derivedFrom: ["https://registry.example/establishment/EST-1"] },
};
const site = { url: "https://salon.example/", text: "Salon Fixture 12 rue Exemple 75018 Paris", links: [context.profileUrl] };
const resolve = (anchors: EstablishmentAnchor[], sites = [site], profile = { url: context.profileUrl, observed_at: at }) => resolveProfileFirstIdentity({ anchors, sites, profile, context, observedAt: at });
const copy = () => structuredClone(anchor);

test("independent address/postcode admits and reuses canonical V2 HIGH, no alternate engine", () => {
  const a = admitProfileFirstAnchor(anchor, context); assert.equal(a.outcome, "ADMITTED");
  if (a.outcome === "ADMITTED") assert.equal(a.strongEvidence, "ADDRESS_POSTCODE");
  const result = resolve([anchor]); assert.equal(result.identity?.match.resolverVersion, "COMMERCIAL_INSTAGRAM_RESOLVER_V2");
  assert.equal(result.identity?.match.confidence, "HIGH"); assert.equal(result.scoringAllowed, true);
});
test("verifiedPhone alone admits, but does NOT lower V2's existing postcode/site threshold", () => {
  const a = copy(); a.candidate.address = ""; a.candidate.postalCode = ""; a.candidate.verifiedPhone = "0100000000";
  const r = admitProfileFirstAnchor(a, context); assert.equal(r.outcome, "ADMITTED");
  if (r.outcome === "ADMITTED") assert.equal(r.strongEvidence, "VERIFIED_PHONE");
  assert.equal(resolve([a]).scoringAllowed, false);
});
test("exact SIRET admits through the existing Sirene government reference, no Sirene call", () => {
  const a = copy(); a.candidate.provider = a.provenance.provider = "sirene"; a.candidate.externalId = "12345678900001";
  a.candidate.source.url = a.provenance.reference = "https://annuaire-entreprises.data.gouv.fr/etablissement/12345678900001";
  a.provenance.derivedFrom = [a.provenance.reference]; a.candidate.address = ""; a.candidate.postalCode = "";
  a.legalId = { type: "SIRET", value: a.candidate.externalId, exact: true };
  assert.equal(admitProfileFirstAnchor(a, context).outcome, "ADMITTED"); assert.equal(resolve([a]).scoringAllowed, false);
});
test("provider-neutral legal identity, no requirement to use Sirene", () => {
  const a = copy(); a.candidate.address = ""; a.candidate.postalCode = ""; a.legalId = { type: "LEGAL_ID", value: "REG-EST-01", exact: true };
  assert.equal(admitProfileFirstAnchor(a, context).outcome, "ADMITTED");
});
test("Instagram-only => HOLD and identity NOT_REACHED, never LOW", () => {
  const r = resolve([]); assert.equal(r.admission.outcome, "HOLD"); assert.equal(r.admission.reason, "INSUFFICIENT_ANCHOR"); assert.equal(r.identity, null); assert.equal(r.scoringAllowed, false);
});
for (const source of [context.profileUrl, "https://salon.example/contact", "https://sub.salon.example/contact", "https://wa.me/fixture", "https://t.me/fixture", "https://iarabeauty.com/pro/fixture", "https://pagesjaunes.fr/pro/fixture"]) {
  test(`non-independent source blocks admission: ${new URL(source).hostname}`, () => {
    const a = copy(); a.candidate.source.url = a.provenance.reference = source; a.provenance.derivedFrom = [source];
    assert.equal(admitProfileFirstAnchor(a, context).outcome, "HOLD"); assert.equal(resolve([a]).identity, null);
  });
}
test("circular proof remains blocked when copied behind a different provider/reference", () => {
  const a = copy(); a.provenance.derivedFrom.push("https://salon.example/contact");
  assert.equal(admitProfileFirstAnchor(a, context).outcome, "HOLD");
});
test("unusable candidate URL cannot conceal its host from the circular-proof check", () => {
  const a = copy(); a.candidate.source.url = a.provenance.reference = "https://salon.example/contact"; a.provenance.derivedFrom = [a.provenance.reference];
  assert.equal(admitProfileFirstAnchor(a, { ...context, candidateWebsiteUrls: ["https://fixture:fixture@salon.example/"] }).outcome, "HOLD");
});
for (const field of ["provider", "reference", "observedAt"] as const) test(`missing provenance ${field} holds`, () => {
  const a = copy(); a.provenance[field] = ""; assert.equal(admitProfileFirstAnchor(a, context).outcome, "HOLD");
});
test("no external ID can use an explicit stable reference", () => { const a = copy(); a.candidate.externalId = ""; assert.equal(admitProfileFirstAnchor(a, context).outcome, "ADMITTED"); });
test("name/city and SERP snippet alone are never an anchor", () => { const a = copy(); a.candidate.address = ""; a.candidate.postalCode = ""; assert.equal(admitProfileFirstAnchor(a, context).outcome, "HOLD"); });
test("contradictory country/city and ineligible establishment reject closed", () => {
  const outside = copy(); outside.candidate.city = "Lyon"; assert.equal(admitProfileFirstAnchor(outside, context).outcome, "REJECT");
  const a = copy(); a.candidate.country = "ZA"; assert.equal(admitProfileFirstAnchor(a, context).outcome, "REJECT");
  const b = copy(); b.candidate.eligibility.prospectingEligible = false; assert.equal(admitProfileFirstAnchor(b, context).outcome, "REJECT");
});
test("ambiguous establishments hold; explicit profile contradiction reuses V2 rejection", () => {
  const b = copy(); b.candidate.externalId = "EST-2"; assert.equal(resolve([anchor, b]).admission.outcome, "HOLD");
  const r = resolve([anchor], [site], { url: context.profileUrl, observed_at: at, ...{ alias: "Salon Fixture", city: "Lyon" } });
  assert.equal(r.identity?.match.reason, "IDENTITY_CONTRADICTION"); assert.equal(r.scoringAllowed, false);
});
test("another IG account on a certified site cannot certify the candidate", () => {
  const r = resolve([anchor], [{ ...site, links: ["https://instagram.com/another/"] }]); assert.equal(r.scoringAllowed, false); assert.equal(r.candidateIdentityConfidence, null);
});
for (const [url, type] of [["https://iarabeauty.com/pro/fixture", "THIRD_PARTY_BOOKING"], ["https://planity.com/fixture", "THIRD_PARTY_BOOKING"], ["https://wa.me/fixture", "CONTACT_PLATFORM"], ["https://api.whatsapp.com/", "CONTACT_PLATFORM"], ["https://t.me/fixture", "CONTACT_PLATFORM"], ["https://telegram.org/", "CONTACT_PLATFORM"]]) {
  test(`third party ${new URL(url).hostname} never official`, () => {
    assert.equal(classifyProfileFirstWebsiteUrl(url), type); assert.notEqual(new CommercialOfficialWebsiteResolver().evaluate(anchor.candidate, { ...site, url }, at).classification, "OFFICIAL_SITE");
  });
}
test("UNKNOWN domain remains UNKNOWN without independent establishment/site consistency", () => {
  assert.equal(classifyProfileFirstWebsiteUrl(site.url), "UNKNOWN");
  assert.equal(new CommercialOfficialWebsiteResolver().evaluate(anchor.candidate, { ...site, text: "Salon Fixture Paris" }, at).classification, "UNKNOWN");
});
test("strict bare caption domain => hint only; ZA URL extraction unchanged", () => {
  const values = ["Réservez Lemaitrebarbierparis.fr !", "lemaitrebarbierparis.fr", "name@example.fr", "@account.fr", "127.0.0.1", "bad_domain.fr", "https://already.fr/"];
  const hints = extractFranceCaptionDomainHints(values); assert.equal(hints.length, 1); assert.equal(hints[0].url, "https://lemaitrebarbierparis.fr/"); assert.equal(hints[0].type, "CANDIDATE_DOMAIN_HINT");
  assert.deepEqual(extractObservedUrls([values[0]]), []);
});
test("already collected social links propagate with source page; usable only after site certification", async () => {
  let calls = 0;
  const summary = await enrichCommercialWebsite({ market: "FR", websiteUrl: site.url, maxPages: 1, fetchImpl: async () => { calls++; return new Response(`<p>${site.text}</p><a href="${context.profileUrl}">Instagram</a>`, { headers: { "content-type": "text/html" } }); } });
  assert.equal(calls, 1); assert.equal(summary.socialLinks?.[0].sourcePage, site.url); assert.equal(summary.socialLinks?.[0].type, "CANDIDATE_SOCIAL_LINK");
  assert.equal(resolve([], summary.identityPages).identity, null);
  assert.equal(resolve([anchor], summary.identityPages).identity?.match.confidence, "HIGH");
  assert.equal(resolve([anchor], summary.identityPages?.map(p => ({ ...p, text: "Salon Fixture Paris" }))).scoringAllowed, false);
  const za = await enrichCommercialWebsite({ websiteUrl: site.url, maxPages: 1, fetchImpl: async () => new Response("<p>ZA unchanged</p>", { headers: { "content-type": "text/html" } }) });
  assert.equal("identityPages" in za, false); assert.equal("socialLinks" in za, false);
});
test("existing structured adapter ignores profile/SERP records and only locates possible anchors", () => {
  const record = { country_code: "FR", identity_mode: "structured", metadata_safe: { structured_discovery: anchor.candidate } };
  assert.equal(anchorsFromStructuredBusinesses([record], { businessName: "Salon Fixture", instagramHandle: "salon_fixture" }).length, 1);
  assert.equal(anchorsFromStructuredBusinesses([{ ...record, identity_mode: "legacy" }], { businessName: "Salon Fixture", instagramHandle: "salon_fixture" }).length, 0);
});
test("all 12 canonical Beauty & Aesthetics subsegments preserved exactly", () => {
  assert.deepEqual(COMMERCIAL_DISCOVERY_SUBSEGMENTS, ["Aesthetic Clinic", "Skin Clinic", "Med Spa", "Beauty Salon", "Hair Salon", "Hair Stylist", "Nail Studio", "Lash Studio", "Brow Studio", "Laser Clinic", "Makeup Artist", "Wellness Studio"]);
});
for (const handle of ["lemaitrebarbierparis", "mhaesthetic.clinic", "lashbyiava", "maisons_cils"]) test(`offline persisted regression ${handle}: no independent anchor => HOLD, no identity LOW/HIGH`, () => {
  const r = resolveProfileFirstIdentity({ anchors: [], context: { ...context, profileUrl: `https://instagram.com/${handle}/` }, sites: handle === "lemaitrebarbierparis" ? [{ url: "https://lemaitrebarbierparis.fr/", text: "Le Maître Barbier Paris 5 rue du Ruisseau 75018 Paris, France", links: [] }] : [], profile: { url: `https://instagram.com/${handle}/`, observed_at: at }, observedAt: at });
  assert.equal(r.admission.reason, "INSUFFICIENT_ANCHOR"); assert.equal(r.identity, null); assert.equal(r.scoringAllowed, false);
});
test("MH observed Paris 16e stays LOCATION MEDIUM, never identity certification", () => {
  const location = resolveCommercialLocation({ countryCode: "FR", requestedCity: "Paris", signals: { instagram: ["MH AESTHETIC — Paris 16e Sur rendez-vous"] } });
  assert.equal(location.confidence, "MEDIUM"); assert.equal(location.city, "Paris");
});
test("no source/scoring/send/DB schema contracts modified by anchor helper", () => {
  const source = readFileSync(new URL("./profile-first-anchor.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|SireneProvider|lookupInstagramPublicProfile|analyzeCommercial|sendEmail|\.rpc\(/);
});
