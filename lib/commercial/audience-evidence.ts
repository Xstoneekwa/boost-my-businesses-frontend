/** Only canonical server-written discovery peer snapshots qualify. Observations
 * about the prospect, a free-text reason or an AI confidence are not audiences.
 * Confidence on these records is LOCATION confidence. Require high confidence,
 * recorded relevance, matching identity/location and independent category overlap. */
export const AUDIENCE_EVIDENCE_POLICY = "commercial_audience_evidence_v1";
export type CtaMode = "KNOWN_AUDIENCES" | "DISCOVERY_EXPLANATION";
type Row = Record<string, unknown>;
export type AudienceContext = { lead: Row; business: Row };
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" ? v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";
const families = [
  /\b(?:hair|hairstyl\w*|coiff\w*|braids?|wigs?|balayage)\b/,
  /\b(?:nails?|ongl\w*|manicur\w*|pedicur\w*)\b/,
  /\b(?:lash\w*|brows?|cils?|sourcils?)\b/,
  /\b(?:make.?up|mua|maquill\w*)\b/,
  /\b(?:skin|aesthetic\w*|med spa|peau|estheti\w*|dermaplan\w*|chemical peels?)\b/,
];
export function resolveCommercialAudienceEvidence(context?: AudienceContext) {
  const lead = row(context?.lead), business = row(context?.business);
  const stored = row(lead.audience_context_safe);
  const suggestions = Array.isArray(stored.suggestions) ? stored.suggestions : [];
  const city = text(lead.city_snapshot || business.city);
  const own = text(business.instagram_handle).replace(/^@/, "");
  // Subsegment is canonical and narrower than an AI-written description.
  const target = text(lead.subsegment_snapshot || business.subsegment);
  const matching = families.filter(pattern => pattern.test(target));
  const handles = new Set<string>();
  if (stored.source === "deterministically_filtered_discovery_peers" && city && own && matching.length) {
    for (const value of suggestions) {
      const c = row(value), handle = text(c.instagram_handle).replace(/^@/, "");
      if (!/^[a-z0-9._]{1,30}$/.test(handle) || handle === own || ["p", "reel", "reels", "explore"].includes(handle)) continue;
      if (c.source !== "searchapi_google_serp" || c.confidence !== "high"
        || typeof c.audience_relevance_score !== "number" || c.audience_relevance_score < 0.8 || c.audience_relevance_score > 1
        || text(c.location) !== city || !text(c.source_query).includes("instagram.com")
        || !text(c.source_query).includes(city)) continue;
      try {
        const url = new URL(String(c.profile_url));
        if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname)
          || url.pathname.replace(/^\/|\/$/g, "").toLowerCase() !== handle || url.search || url.hash) continue;
      } catch { continue; }
      // Do not derive business relevance from source_query or the generated reason.
      if (!matching.some(pattern => pattern.test(text(c.name) + " " + text(c.category)))) continue;
      handles.add(handle);
    }
  }
  return {
    policy: AUDIENCE_EVIDENCE_POLICY,
    mode: (handles.size ? "KNOWN_AUDIENCES" : "DISCOVERY_EXPLANATION") as CtaMode,
    verifiedRelevantAudienceCandidatesCount: handles.size,
    candidateHandles: [...handles].sort(),
    potentialAudiencesCount: suggestions.length,
    reason: handles.size ? "canonical_high_confidence_relevant_peers" : "no_sufficiently_verified_relevant_peer",
  };
}
