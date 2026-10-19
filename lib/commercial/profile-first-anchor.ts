import type { StructuredCandidate } from "./structured-discovery-contract";
import { businessAliases, classifyWebsiteUrl, evaluateBusinessResolution, type BusinessResolution, type PublicProfileEvidence } from "./business-resolution-v2";
import { normalizeIdentityText, rootInstagramHandle, type SearchHit, type SiteEvidence } from "./structured-instagram-resolver";

export const PROFILE_FIRST_ANCHOR_CONTRACT = "PROFILE_FIRST_ESTABLISHMENT_ANCHOR_V1";
export function classifyProfileFirstWebsiteUrl(value: string) {
  const classification = classifyWebsiteUrl(value);
  try {
    if (classification === "SHARED_PLATFORM" && /(^|\.)(planity|treatwell|fresha|booksy|calendly|resalib)\./.test(new URL(value).hostname)) return "THIRD_PARTY_BOOKING" as const;
  } catch { /* UNKNOWN remains unqualified. */ }
  return classification;
}
/** Only server-side, already-authorized structured sources may supply this input.
 * The profile, SERP and candidate website are observations, never anchor producers. */
export type EstablishmentAnchor = {
  candidate: StructuredCandidate;
  provenance: {
    kind: "STRUCTURED_ESTABLISHMENT";
    provider: string;
    reference: string;
    observedAt: string;
    /** Original source/lineage, not a URL of an intermediary that copied the site. */
    derivedFrom: string[];
  };
  legalId?: { type: "SIRET" | "LEGAL_ID"; value: string; exact: true };
};
export type AnchorContext = { country: "FR"; requestedCity: string; profileUrl: string; candidateWebsiteUrls: string[] };
export type AnchorAdmission =
  | { outcome: "ADMITTED"; reason: "INDEPENDENT_ESTABLISHMENT_ANCHOR"; candidate: StructuredCandidate; provenance: EstablishmentAnchor["provenance"]; strongEvidence: "ADDRESS_POSTCODE" | "VERIFIED_PHONE" | "EXACT_LEGAL_ID" }
  | { outcome: "HOLD"; reason: "INSUFFICIENT_ANCHOR"; detail: string; identityConfidence: null }
  | { outcome: "REJECT"; reason: "CONTRADICTION"; detail: string; identityConfidence: null };
const hold = (detail: string): AnchorAdmission => ({ outcome: "HOLD", reason: "INSUFFICIENT_ANCHOR", detail, identityConfidence: null });
const reject = (detail: string): AnchorAdmission => ({ outcome: "REJECT", reason: "CONTRADICTION", detail, identityConfidence: null });
function domain(value: string) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(u.hostname)) return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}
const sameDomain = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

export function admitProfileFirstAnchor(anchor: EstablishmentAnchor | null, context: AnchorContext): AnchorAdmission {
  if (!anchor) return hold("no_independent_structured_establishment");
  const c = anchor.candidate, p = anchor.provenance;
  if (!c || !p || p.kind !== "STRUCTURED_ESTABLISHMENT" || !p.provider?.trim() || p.provider !== c.provider || !p.reference?.trim()
    || !p.observedAt || !Number.isFinite(Date.parse(p.observedAt)) || !Array.isArray(p.derivedFrom) || !p.derivedFrom.length
    || !c.source?.url || !c.source.observedAt || !c.businessName?.trim() || !c.city?.trim()) return hold("incomplete_provenance_or_establishment");
  // This checks original lineage as well as the stored reference, including redirects.
  // A renamed provider or copied site address must not turn self-evidence independent.
  const candidateDomains = context.candidateWebsiteUrls.flatMap(value => {
    // Even an unusable hint (credentials/non-HTTPS) must not hide the same
    // website from the circular-proof check. This never authorizes fetching it.
    try { return [new URL(value).hostname.toLowerCase().replace(/^www\./, "")]; } catch { return []; }
  });
  const sources = [c.source.url, p.reference, ...p.derivedFrom];
  if (sources.some(value => {
    const d = domain(value);
    // Sirene's existing normalizer cites the government establishment permalink.
    // This exact registry reference is not an unqualified directory listing.
    const sireneReference = c.provider === "sirene" && /^\d{14}$/.test(c.externalId) && value === `https://annuaire-entreprises.data.gouv.fr/etablissement/${c.externalId}`;
    return !d || !sireneReference && classifyWebsiteUrl(value) !== "UNKNOWN" || /(^|\.)(instagram|facebook|tiktok|x)\./.test(d)
      || candidateDomains.some(candidate => sameDomain(candidate, d));
  })) return hold("source_not_independent_or_circular");
  if (c.country !== context.country || context.requestedCity !== "France" && normalizeIdentityText(c.city) !== normalizeIdentityText(context.requestedCity)) return reject("establishment_outside_requested_market_or_city");
  if (!c.eligibility?.prospectingEligible) return reject("establishment_not_eligible");
  const strongEvidence = c.address?.trim().length >= 8 && /^\d{5}$/.test(c.postalCode) ? "ADDRESS_POSTCODE"
    : c.verifiedPhone && /^\+?\d[\d ().-]+$/.test(c.verifiedPhone) && c.verifiedPhone.replace(/\D/g, "").length >= 8 ? "VERIFIED_PHONE"
    : anchor.legalId?.exact === true && (anchor.legalId.type === "SIRET" ? /^\d{14}$/.test(anchor.legalId.value) : /^[\p{L}\p{N}][\p{L}\p{N}._/-]{3,79}$/u.test(anchor.legalId.value)) ? "EXACT_LEGAL_ID" : null;
  if (!strongEvidence) return hold("independent_strong_evidence_missing");
  return { outcome: "ADMITTED", reason: "INDEPENDENT_ESTABLISHMENT_ANCHOR", candidate: c, provenance: p, strongEvidence };
}

/** Reuses V2 verbatim. Admission alone never certifies a website or a handle. */
export function resolveProfileFirstIdentity(input: { anchors: EstablishmentAnchor[]; context: AnchorContext; sites: SiteEvidence[]; profile: PublicProfileEvidence; hits?: SearchHit[]; observedAt: string }) {
  const admissions = input.anchors.map(anchor => admitProfileFirstAnchor(anchor, input.context));
  const admitted = admissions.filter((a): a is Extract<AnchorAdmission, { outcome: "ADMITTED" }> => a.outcome === "ADMITTED");
  const unique = [...new Map(admitted.map(a => [`${a.candidate.provider}:${a.candidate.externalId || a.provenance.reference}`, a])).values()];
  const firstHold = admissions.find(a => a.outcome === "HOLD");
  const admission = admissions.find(a => a.outcome === "REJECT") ?? (unique.length === 1 ? unique[0] : hold(unique.length ? "ambiguous_independent_establishments" : firstHold?.detail ?? "no_independent_structured_establishment"));
  if (admission.outcome !== "ADMITTED") return { contract: PROFILE_FIRST_ANCHOR_CONTRACT, admission, identity: null, candidateIdentityConfidence: null, scoringAllowed: false };
  const identity: BusinessResolution = evaluateBusinessResolution(admission.candidate, input.hits ?? [], input.sites, [input.profile], input.observedAt);
  // V2 may find another legitimate account. It must never certify THIS candidate by accident.
  const sameHandle = identity.match.matchedHandle === rootInstagramHandle(input.context.profileUrl);
  return { contract: PROFILE_FIRST_ANCHOR_CONTRACT, admission, identity, candidateIdentityConfidence: sameHandle ? identity.match.confidence : null, scoringAllowed: identity.match.confidence === "HIGH" && sameHandle };
}

/** Adapter for pre-existing structured business records, not for raw profile/SERP data.
 * Selection by alias/handle only locates a possible anchor; it is never HIGH proof. */
export function anchorsFromStructuredBusinesses(records: Array<Record<string, unknown>>, input: { businessName: string; instagramHandle: string }): EstablishmentAnchor[] {
  return records.flatMap(record => {
    if (record.identity_mode !== "structured" || record.country_code !== "FR") return [];
    const metadata = record.metadata_safe as { structured_discovery?: StructuredCandidate } | null;
    const c = metadata?.structured_discovery;
    if (!c?.provider || !c.source?.url || !c.eligibility || !Array.isArray(c.business_aliases ?? [])) return [];
    const sameName = businessAliases(c).some(a => normalizeIdentityText(a.value) === normalizeIdentityText(input.businessName));
    if (!sameName && record.instagram_handle_normalized !== input.instagramHandle) return [];
    return [{ candidate: c, provenance: { kind: "STRUCTURED_ESTABLISHMENT" as const, provider: c.provider, reference: c.source.url, observedAt: c.source.observedAt, derivedFrom: [c.source.url] },
      ...(c.provider === "sirene" && /^\d{14}$/.test(c.externalId) ? { legalId: { type: "SIRET" as const, value: c.externalId, exact: true as const } } : {}) }];
  });
}
