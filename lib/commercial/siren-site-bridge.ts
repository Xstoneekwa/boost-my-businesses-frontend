import { classifyProfileFirstWebsiteUrl } from "./profile-first-anchor";
import { rootInstagramHandle } from "./structured-instagram-resolver";
import { administrativeName } from "./france-administrative-territory";

export const SIREN_SITE_BRIDGE_CONTRACT = "FIRST_PARTY_SIREN_UNIQUE_DINUM_ESTABLISHMENT_V1";
/** Trusted, already captured server-side observations; never a browser assertion.
 * No fetch, selection by SIREN alone, or alternate Instagram identity engine.
 */
export type FirstPartySirenEvidence = {
  instagram: { profileUrl: string; linkedWebsiteUrl: string; linkField: "external_url" | "bio_link"; sourceReference: string; observedAt: string };
  site: { url: string; legalPageUrl: string; kind: "LEGAL_PAGE" | "LEGAL_FOOTER"; observedAt: string;
    siren: string; legalName: string; address: string; postalCode: string; city: string };
  contradictions: string[];
};
const date = (v: string) => typeof v === "string" && Number.isFinite(Date.parse(v));
const useful = (v: string, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
function host(value: string, allowHttp = false) {
  try {
    const u = new URL(value);
    if (!(u.protocol === "https:" || allowHttp && u.protocol === "http:") || u.username || u.password || u.port
      || !u.hostname.includes(".") || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/.test(u.hostname)) return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}
export function validateFirstPartySirenEvidence(e: FirstPartySirenEvidence): string | null {
  if (!e?.instagram || !e.site || !Array.isArray(e.contradictions)) return "incomplete_first_party_siren_evidence";
  if (e.contradictions.length) return "strong_identity_contradiction";
  const ig = e.instagram, s = e.site;
  if (!rootInstagramHandle(ig.profileUrl) || !["external_url", "bio_link"].includes(ig.linkField)
    || !useful(ig.sourceReference, 500) || !date(ig.observedAt)) return "direct_instagram_link_provenance_required";
  const domain = host(s.url);
  if (!domain || host(ig.linkedWebsiteUrl, true) !== domain || host(s.legalPageUrl) !== domain
    || classifyProfileFirstWebsiteUrl(s.url) !== "UNKNOWN" || classifyProfileFirstWebsiteUrl(s.legalPageUrl) !== "UNKNOWN"
    || classifyProfileFirstWebsiteUrl(ig.linkedWebsiteUrl.replace(/^http:/, "https:")) !== "UNKNOWN") return "direct_first_party_domain_required";
  if (!["LEGAL_PAGE", "LEGAL_FOOTER"].includes(s.kind) || !date(s.observedAt)) return "legal_page_provenance_required";
  if (typeof s.siren !== "string" || !/^\d{9}$/.test(s.siren)) return "observed_exact_site_siren_required";
  if (!useful(s.legalName, 240) || !useful(s.city, 160) || typeof s.postalCode !== "string" || !/^\d{5}$/.test(s.postalCode)) return "site_legal_name_city_postcode_required";
  // Require observed street-level information, not postcode/city alone.
  const address = useful(s.address, 400) ? administrativeName(s.address) : "";
  const locality = administrativeName(`${s.postalCode} ${s.city}`);
  if (!address.endsWith(locality) || address.slice(0, -locality.length).trim().length < 8
    || !/\d/.test(address.slice(0, -locality.length)) || !/\p{L}/u.test(address.slice(0, -locality.length))) return "precise_observed_site_address_required";
  return null;
}

/** Exact token normalization already used by the canonical France administrative
 * contract: case, accents and separators. No edit distance, substring or new
 * abbreviation expansion. An unresolved abbreviation remains a non-match.
 */
export function compareSirenSiteEstablishment(e: FirstPartySirenEvidence, official: {
  siren: string; siret: string; address: string; postalCode: string; city: string; legalName: string;
}): { outcome: "MATCH" | "HOLD" | "NO_MATCH" | "CONTRADICTION"; reason: string } {
  const invalid = validateFirstPartySirenEvidence(e);
  if (invalid) return { outcome: "HOLD", reason: invalid };
  if (!/^\d{9}$/.test(official.siren) || !/^\d{14}$/.test(official.siret)) return { outcome: "HOLD", reason: "exact_official_siren_siret_required" };
  if (!official.siret.startsWith(official.siren)) return { outcome: "CONTRADICTION", reason: "siret_siren_mismatch" };
  if (official.siren !== e.site.siren) return { outcome: "NO_MATCH", reason: "site_siren_not_confirmed_by_registry" };
  if (!/^\d{5}$/.test(official.postalCode) || !useful(official.address, 400) || !useful(official.city, 160)) return { outcome: "HOLD", reason: "official_address_postcode_city_missing" };
  if (official.legalName && administrativeName(official.legalName) !== administrativeName(e.site.legalName)) return { outcome: "CONTRADICTION", reason: "explicit_legal_name_contradiction" };
  if (official.postalCode !== e.site.postalCode || administrativeName(official.city) !== administrativeName(e.site.city)
    || administrativeName(official.address) !== administrativeName(e.site.address)) return { outcome: "NO_MATCH", reason: "site_establishment_address_not_confirmed" };
  return { outcome: "MATCH", reason: "exact_siren_address_postcode_confirmed" };
}
