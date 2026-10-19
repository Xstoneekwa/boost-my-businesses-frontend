/** SERP-only triage: never an identity/location confidence or DM suitability score. */
export type FranceSerpCandidate = { username: string; profileUrl: string; title: string | null; snippet: string | null };
export type FranceAcquisitionDecision = { keep: boolean; reason: string };
const genericPaths = new Set(["policy", "policies", "privacy", "terms", "legal", "about", "help", "accounts", "login", "explore", "p", "reel", "reels", "stories", "share", "sharing", "developer", "developers", "api", "direct"]);
const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const beauty = /\b(?:aestheti\w*|estheti\w*|beaut[ey]\w*|coiff\w*|barb(?:er|ier)\w*|ongl\w*|cils?|sourcil\w*|maquill\w*|epil\w*|dermato\w*|salon|skin|spa|lash\w*|brow\w*|nails?|make[ -]?up|hair\w*|laser|wellness|massage|bien[- ]etre)\b/iu;
const unrelated: Array<[string, RegExp]> = [
  ["politics", /\b(?:politici[ae]n\w*|politician|senador|senateur|presidenci\w*|presiden(?:t|ce)\w*|advogado)\b/iu],
  ["music", /\b(?:music|musician|musicien\w*|singer|rappeur\w*|rock band)\b/iu],
  ["electrical_services", /\b(?:electrician|electricien\w*|eletric\w*|electrical installation)\b/iu],
  ["school_media", /\b(?:student[- ]led|school news|news|actualites scolaires)\b/iu],
  ["craft_products", /\b(?:crochet\w*|amigurumi)\b/iu],
  ["technology_services", /tech\s+solutions\b|\b(?:it support|computer repair|technology services)\b/iu],
  ["model_training", /школ[аы]\s+модел|\b(?:model(?:ling|ing)? school|acting school)\b/iu],
];

export function assessFranceSerpCandidate(candidate: FranceSerpCandidate): FranceAcquisitionDecision {
  let url: URL;
  try { url = new URL(candidate.profileUrl); } catch { return { keep: false, reason: "invalid_profile_url" }; }
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port
    || parts.length !== 1 || genericPaths.has(parts[0].toLowerCase()) || parts[0].toLowerCase() !== candidate.username.toLowerCase()) {
    return { keep: false, reason: "generic_or_non_profile_url" };
  }
  // Query terms and handle spelling do not prove the business vertical.
  const observed = normalize(`${candidate.title ?? ""} ${candidate.snippet ?? ""}`);
  if (/^(?:privacy policy|politique de confidentialite|terms of use|cookie policy)\b/iu.test(observed.trim())) return { keep: false, reason: "generic_policy_page" };
  // Positive service evidence wins over incidental negatives (e.g. bridal hair
  // for musicians). Unknown/short snippets remain eligible for enrichment.
  if (beauty.test(observed)) return { keep: true, reason: "beauty_terms_observed" };
  const negative = unrelated.find(([, pattern]) => pattern.test(observed));
  return negative ? { keep: false, reason: `explicit_non_beauty_${negative[0]}` } : { keep: true, reason: "insufficient_serp_evidence_keep_for_review" };
}
