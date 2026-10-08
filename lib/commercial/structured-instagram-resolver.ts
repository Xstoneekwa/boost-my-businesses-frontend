import type { StructuredCandidate } from "./structured-discovery-contract";

export type InstagramMatch = { matchedHandle: string | null; matchedProfileUrl: string | null; confidence: "HIGH" | "MEDIUM" | "LOW"; signals: string[]; sources: string[]; reason: string; resolverVersion: string; establishmentSpecific: boolean };
export type SearchHit = { url: string; title: string; snippet: string };
export type SiteEvidence = { url: string; text: string; links: string[] };
export const normalizeIdentityText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function rootInstagramHandle(value: string): string | null {
  try { const url = new URL(value); if (!["instagram.com","www.instagram.com"].includes(url.hostname) || url.protocol !== "https:") return null;
    const pieces = url.pathname.split("/").filter(Boolean), handle = pieces[0]?.toLowerCase();
    return !url.username && !url.password && !url.port && pieces.length === 1 && /^[a-z0-9._]{1,30}$/.test(handle) && !["p","reel","reels","explore","stories","accounts","direct","share","sharing","about","developer","legal"].includes(handle) ? handle : null;
  } catch { return null; }
}
export function isSharedResolverHost(value: string) {
  try { return /(^|\.)(planity|treatwell|facebook|instagram|google|yelp|pagesjaunes|societe|pappers|verif|linkedin|tiktok|fresha|booksy|linktr)\./i.test(new URL(value).hostname); } catch { return true; }
}
export function targetedInstagramQuery(c: StructuredCandidate) {
  const clean = (s: string) => s.replace(/["\\\r\n]/g," ").slice(0,160);
  return `"${clean(c.businessName)}" "${clean(c.city)}" Instagram`;
}
const match = (handle: string | null, confidence: InstagramMatch["confidence"], reason: string, signals: string[], sources: string[], establishmentSpecific = false): InstagramMatch => ({ matchedHandle: handle, matchedProfileUrl: handle ? `https://www.instagram.com/${handle}/` : null, confidence, reason, signals, sources, establishmentSpecific, resolverVersion: "COMMERCIAL_INSTAGRAM_RESOLVER_V1" });
/** Search snippets are hints, never independent verification of an establishment. */
export function evaluateInstagramMatch(c: StructuredCandidate, hits: SearchHit[], sites: SiteEvidence[]): InstagramMatch {
  if (!c.eligibility.prospectingEligible) return match(null,"LOW","ineligible",[],[]);
  const strong = new Map<string,string[]>();
  for (const site of sites) {
    if (isSharedResolverHost(site.url)) continue;
    const content = normalizeIdentityText(site.text);
    if (/annuaire|entreprises similaires|entreprises à proximité|business directory/i.test(site.text)) continue;
    const exactId = c.externalId.length >= 9 && content.includes(normalizeIdentityText(c.externalId));
    const exactAddress = c.address.length >= 8 && content.includes(normalizeIdentityText(c.address)) && content.includes(normalizeIdentityText(c.city)) && content.includes(c.postalCode);
    const name = normalizeIdentityText(c.businessName);
    // An entire directory/brand location index is not establishment-specific.
    const handles = [...new Set(site.links.map(rootInstagramHandle).filter((h): h is string => Boolean(h)))];
    if (name.length >= 4 && content.includes(name) && exactAddress && handles.length === 1) strong.set(handles[0], [site.url, exactId ? "exact_provider_identity_and_address" : "exact_establishment_address"]);
  }
  if (strong.size === 1) { const [handle,[source,signal]] = [...strong.entries()][0]; return match(handle,"HIGH","establishment_site_direct_instagram",[signal,"business_name","direct_instagram_link"],[source],true); }
  if (strong.size > 1) return match(null,"MEDIUM","conflicting_verified_accounts",[],[...strong.values()].map(v => v[0]));
  const candidates = hits.filter(h => rootInstagramHandle(h.url) && normalizeIdentityText(h.title+" "+h.snippet).includes(normalizeIdentityText(c.city)) && normalizeIdentityText(h.title+" "+h.snippet).includes(normalizeIdentityText(c.businessName)));
  if (c.authorizedSocialLink && rootInstagramHandle(c.authorizedSocialLink)) return match(rootInstagramHandle(c.authorizedSocialLink),"MEDIUM","provider_link_requires_independent_corroboration",["provider_social_link"],[c.authorizedSocialLink]);
  if (candidates.length) return match(rootInstagramHandle(candidates[0].url),"MEDIUM","name_city_only_requires_review",["name_city_search_hint"],candidates.slice(0,3).map(h=>h.url));
  return match(null,"LOW","no_establishment_specific_match",[],[]);
}
export function structuredScoringAllowed(candidate:StructuredCandidate, match:InstagramMatch, profile:{ok:boolean;status:string;is_private:boolean|null;canonical_username:string|null}) {
  return candidate.eligibility.prospectingEligible && match.confidence==="HIGH" && Boolean(match.matchedHandle) && profile.ok && profile.status==="found" && profile.is_private===false && profile.canonical_username?.toLowerCase()===match.matchedHandle;
}
export function enforceChainSafety(results: Array<{candidate: StructuredCandidate; match: InstagramMatch}>) {
  const counts = new Map<string,Set<string>>();
  for (const r of results) if (r.match.matchedHandle) { const set = counts.get(r.match.matchedHandle) ?? new Set(); set.add(`${r.candidate.provider}:${r.candidate.externalId}`); counts.set(r.match.matchedHandle,set); }
  return results.map(r => r.match.matchedHandle && (counts.get(r.match.matchedHandle)?.size ?? 0) > 1
    ? { ...r, match: { ...r.match, confidence: "MEDIUM" as const, establishmentSpecific: false, reason: "SHARED_BRAND_PROFILE", signals: [...r.match.signals,"multiple_establishment_ids"] } } : r);
}

export class CommercialInstagramResolver {
  async resolveV2(candidate: StructuredCandidate, dependencies: Parameters<typeof import("./business-resolution-v2").resolveBusinessPresence>[1]) {
    return (await import("./business-resolution-v2")).resolveBusinessPresence(candidate, dependencies);
  }
  async resolve(candidate: StructuredCandidate, dependencies: { search: (query: string)=>Promise<SearchHit[]>; site: (url: string)=>Promise<SiteEvidence | null> }) {
    if (!candidate.eligibility.prospectingEligible) return evaluateInstagramMatch(candidate,[],[]);
    const sites: SiteEvidence[] = [];
    if (candidate.officialWebsite && !isSharedResolverHost(candidate.officialWebsite)) { const site = await dependencies.site(candidate.officialWebsite); if(site) sites.push(site); }
    const direct = evaluateInstagramMatch(candidate,[],sites); if (direct.confidence === "HIGH") return direct;
    const hits = await dependencies.search(targetedInstagramQuery(candidate));
    // At most one candidate website; robots + page consumes the two-request site budget.
    if (!candidate.officialWebsite) {
      const name = normalizeIdentityText(candidate.businessName), city = normalizeIdentityText(candidate.city);
      const officialHint = hits.find(h => !isSharedResolverHost(h.url) && normalizeIdentityText(h.title+" "+h.snippet).includes(name) && normalizeIdentityText(h.title+" "+h.snippet).includes(city));
      if (officialHint) { const site = await dependencies.site(officialHint.url); if(site) sites.push(site); }
    }
    return evaluateInstagramMatch(candidate,hits,sites);
  }
}
