import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { admitProfileFirstAnchor, resolveProfileFirstIdentity, type EstablishmentAnchor, type AnchorContext } from "./profile-first-anchor";
import { evaluateBusinessResolution } from "./business-resolution-v2";
import { resolveCommercialLocation } from "./discovery-reliability";
import { assessFranceSerpCandidate } from "./france-acquisition";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio";
import { COMMERCIAL_DISCOVERY_SUBSEGMENTS } from "./discovery-contract";
import { DINUM_ANCHOR_LIMITS } from "./dinum-anchor-client";
import type { PublicProfileEvidence } from "./business-resolution-v2";
import type { InstagramMatch, SiteEvidence } from "./structured-instagram-resolver";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/lemaitre-closed-medium-v1.json", import.meta.url), "utf8")) as {
  closed: boolean; expected: { businessFit: string; anchor: string; location: string; identity: string; strongCrossProof: boolean };
  anchor: EstablishmentAnchor; context: AnchorContext; sites: SiteEvidence[]; profile: PublicProfileEvidence; previous: InstagramMatch;
};
const policy = JSON.parse(readFileSync(new URL("./fixtures/france-identity-outreach-policy-v1.json", import.meta.url), "utf8"));
const observedAt = fixture.profile.observed_at;
const identity = () => evaluateBusinessResolution(fixture.anchor.candidate, [], fixture.sites, [fixture.profile], observedAt, fixture.previous);

test("closed Le Maître truth: prior fit PASS, retained by acquisition; no new scoring or claim of a re-fetched business", () => {
  assert.equal(fixture.closed, true); assert.equal(fixture.expected.businessFit, "PASS");
  const decision = assessFranceSerpCandidate({ username: "lemaitrebarbierparis", profileUrl: fixture.profile.url, title: fixture.profile.alias!, snippet: null });
  assert.equal(decision.keep, true); assert.equal(decision.reason, "beauty_terms_observed");
});
test("closed Le Maître independent establishment anchor remains ADMITTED", () => {
  assert.equal(admitProfileFirstAnchor(fixture.anchor, fixture.context).outcome, fixture.expected.anchor);
});
test("closed Le Maître establishment-confirmed location stays HIGH without inventing profile address", () => {
  const c = fixture.anchor.candidate;
  const location = resolveCommercialLocation({ countryCode: "FR", requestedCity: "Paris", signals: { structured_metadata: [c.address + ", France"] } });
  assert.equal(location.confidence, fixture.expected.location); assert.equal(location.city, "Paris");
  assert.equal(fixture.profile.address, undefined); assert.equal(fixture.profile.phone, undefined);
});
test("closed Le Maître cannot become HIGH without new strong account cross-proof", () => {
  const result = identity(); assert.equal(result.match.confidence, fixture.expected.identity); assert.equal(result.match.confidence, "MEDIUM");
  assert.equal(result.match.establishmentSpecific, false); assert.equal(fixture.expected.strongCrossProof, false);
  assert.ok(result.evidence.some(e => e.type === "PREVIOUS_MATCH_HINT" && e.strength === "SECONDARY"));
  assert.ok(!result.evidence.some(e => e.type === "OFFICIAL_SITE_INSTAGRAM_LINK"));
  assert.ok(fixture.sites.every(s => s.links.length === 0)); assert.equal(fixture.anchor.candidate.verifiedPhone, undefined);
});
test("HOLD means identity NOT_REACHED, not artificial LOW", () => {
  const result = resolveProfileFirstIdentity({ anchors: [], context: fixture.context, sites: fixture.sites, profile: fixture.profile, observedAt });
  assert.equal(result.admission.outcome, "HOLD"); assert.equal(result.identity, null); assert.equal(result.candidateIdentityConfidence, null); assert.equal(result.scoringAllowed, false);
  assert.equal(policy.identity.HOLD.isLow, false); assert.equal(policy.identity.HOLD.futurePipelineAdmission, "NOT_OUTREACH_ELIGIBLE");
});
test("MEDIUM requires human review, never LOW or automatic outreach approval", () => {
  assert.equal(policy.identity.MEDIUM.isLow, false); assert.equal(policy.identity.MEDIUM.futurePipelineAdmission, "HUMAN_REVIEW_REQUIRED");
  assert.equal(policy.identity.MEDIUM.automaticDmEligibility, false); assert.equal(policy.autoApprovalAuthorized, false);
});
test("even a HIGH identity is not automatically a DM prospect", () => {
  assert.equal(policy.identity.HIGH.futurePipelineAdmission, "CONDITIONAL_ON_DM_SUITABILITY_AND_EXISTING_GATES");
  assert.equal(policy.identity.HIGH.automaticDmEligibility, false); assert.equal(policy.liveSendAuthorized, false);
  assert.deepEqual(policy.dimensions, ["BUSINESS_FIT", "LOCATION", "IDENTITY", "DM_SUITABILITY"]);
});
test("exact twelve ZA niches are the France source of truth", () => {
  assert.deepEqual(policy.canonicalSubsegments, COMMERCIAL_DISCOVERY_SUBSEGMENTS);
  assert.equal(policy.canonicalSubsegments.length, 12); assert.deepEqual(policy.nextCanary.acquisitionPortfolio, COMMERCIAL_DISCOVERY_SUBSEGMENTS);
});
for (const segment of COMMERCIAL_DISCOVERY_SUBSEGMENTS) test("France acquisition is preparable for " + segment, () => {
  const queries = buildCommercialDiscoveryQueries("Paris", segment, "FR");
  assert.ok(queries.length > 0 && queries.length <= 8); assert.ok(queries.every(q => q.includes('"Paris"') && q.includes("France")));
  assert.equal(assessFranceSerpCandidate({ username: "fixture_business", profileUrl: "https://instagram.com/fixture_business/", title: segment + " Paris", snippet: null }).keep, true);
});
test("broad France portfolio is not barber/lashes only; ZA behavior stays separately configured", () => {
  const broad = buildCommercialDiscoveryQueries("Paris", undefined, "FR").join("\n");
  for (const term of ["médecine esthétique", "salon de coiffure", "onglerie", "spa", "maquilleuse", "épilation laser"]) assert.ok(broad.includes(term));
  assert.ok(buildCommercialDiscoveryQueries("Cape Town", "Hair Salon", "ZA").every(q => q.includes("South Africa") && !q.includes("France")));
});
test("DM lifecycle and actual-inbound-only conversational AI are independent invariants", () => {
  assert.equal(policy.dmRules.inviteSentDistinct, true); assert.equal(policy.dmRules.inviteSentIsActiveConversation, false);
  assert.equal(policy.dmRules.followupBeforeAcceptance, false); assert.equal(policy.dmRules.unnecessaryLink, false);
  assert.equal(policy.dmRules.firstDm, "SHORT_NATURAL_PERSONALIZED"); assert.equal(policy.dmRules.conversationalAiTrigger, "ACTUAL_INBOUND_REPLY_ONLY");
  assert.deepEqual(policy.dmRules.funnel, ["invite_sent", "accepted", "seen_optional", "replied", "qualified", "booking/conversion"]);
});
test("bounded DINUM remains opt-in; no old candidate reopening, expanded live cohort or canary execution", () => {
  assert.deepEqual(DINUM_ANCHOR_LIMITS, { profiles: 4, calls: 8, perProfile: 2, initial: 1, verification: 1, results: 5, establishments: 10, bytes: 256_000, timeoutMs: 12_000 });
  assert.equal(policy.dinum.noAutomaticDiscoveryCronOrWorkerActivation, true);
  assert.equal(policy.dinum.noImplicitExpansionOfFourProfileLegacyAuthorization, true);
  assert.equal(policy.closedCases.lemaitrebarbierparis.dedicatedInvestigationAllowed, false);
  assert.equal(policy.nextCanary.executed, false); assert.equal(policy.nextCanary.ownerAuthorizationRequired, true);
});
test("fixture minimization excludes raw payloads, contacts, finance, directors and reviews", () => {
  const stored = readFileSync(new URL("./fixtures/lemaitre-closed-medium-v1.json", import.meta.url), "utf8");
  assert.doesNotMatch(stored, /Authorization|api_key|public_phone|public_email|dirigeants|finances|reviews|raw_payload/i);
  assert.equal(policy.dataMinimization.rawProviderPayloadPersistence, false); assert.equal(policy.dataMinimization.directorFinanceAdministrativeHistoryReviews, false);
});
