export type BusinessAlias = { value: string; alias_type: "trade_name" | "establishment_name" | "legal_name" | "provider_selected_name"; provider: string; evidence: string; observed_at: string };
/** Provider-neutral data contract; never accepts a provider's complete raw response. */
export type StructuredCandidate = {
  provider: string; externalId: string; country: string; businessName: string;
  address: string; postalCode: string; city: string; department: string;
  activity: { code: string; nomenclature: string; label: string };
  eligibility: { prospectingEligible: boolean; reason: string; checkedAt: string; policyVersion: string; establishmentDiffusion: string; legalUnitDiffusion: string };
  source: { license: string; attribution: string; observedAt: string; url: string };
  officialWebsite?: string;
  authorizedSocialLink?: string;
  business_aliases?: BusinessAlias[];
  verifiedPhone?: string;
};
export type ProviderPage = { candidates: StructuredCandidate[]; excluded: Array<{ externalId: string; eligibility: StructuredCandidate["eligibility"] }>; nextCursor: string | null; resultCount: number };
export interface StructuredDiscoveryProvider {
  readonly key: string;
  readonly country: string;
  query(date: string, cursor: string): URL;
  normalize(payload: unknown, observedAt: string): ProviderPage;
}
export const STRUCTURED_POC_KEY = "commercial-france-wide-sirene-poc15-v1";
export const STRUCTURED_LIMITS = { candidates: 15, sirene: 2, search: 15, site: 30, enrichment: 15, scoring: 15 } as const;
export type CallKind = "sirene" | "search" | "site" | "enrichment" | "scoring";
export type CallTrace = { kind: CallKind; key: string; purpose: string; startedAt: string; durationMs: number; status: number | string; resultCount: number };
/** Diversity is a deterministic tie-break amongst equally eligible candidates, not a fit score. */
export function selectNationalCohort(pool: StructuredCandidate[], limit = 15) {
  const unique = [...new Map(pool.filter(c => c.eligibility.prospectingEligible).map(c => [`${c.provider}:${c.externalId}`, c])).values()];
  const selected: StructuredCandidate[] = [], cities = new Set<string>(), departments = new Set<string>();
  while (unique.length && selected.length < Math.min(15, Math.max(0, limit))) {
    unique.sort((a,b) => Number(departments.has(a.department)) - Number(departments.has(b.department)) || Number(cities.has(a.city)) - Number(cities.has(b.city)) || a.externalId.localeCompare(b.externalId));
    const next = unique.shift()!; selected.push(next); cities.add(next.city); departments.add(next.department);
  }
  return selected;
}
