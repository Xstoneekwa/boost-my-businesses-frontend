import type { BusinessAlias, ProviderPage, StructuredCandidate, StructuredDiscoveryProvider } from "./structured-discovery-contract";

export const FR_BEAUTY_ACTIVITY_FILTER_V1 = {
  version: "FR_BEAUTY_ACTIVITY_FILTER_V1", nomenclature: "NAFRev2", expiresAt: "2027-01-01",
  included: { "96.02A": "Coiffure", "96.02B": "Soins de beauté" } as Record<string,string>,
};
export const SIRENE_POLICY = "SIRENE_ACTIVE_FULL_DIFFUSION_V1";
export const SIRENE_QUERY = 'periode(etatAdministratifEtablissement:A AND (activitePrincipaleEtablissement:96.02A OR activitePrincipaleEtablissement:96.02B)) AND statutDiffusionEtablissement:O AND statutDiffusionUniteLegale:O AND codeCommuneEtablissement:*';
type Row = Record<string,unknown>;
const row = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown) => typeof v === "string" && v !== "[ND]" ? v.trim() : "";

export function normalizeSireneEstablishment(value: unknown, observedAt: string): { candidate?: StructuredCandidate; externalId: string; eligibility: StructuredCandidate["eligibility"] } {
  const r = row(value), ul = row(r.uniteLegale), address = row(r.adresseEtablissement);
  const periods = (Array.isArray(r.periodesEtablissement) ? r.periodesEtablissement : []).map(row).filter(p => p.dateFin === null);
  const current = periods.length === 1 ? periods[0] : {};
  const externalId = str(r.siret), code = str(current.activitePrincipaleEtablissement), nomenclature = str(current.nomenclatureActivitePrincipaleEtablissement);
  const eligibility = { prospectingEligible: false, reason: "", checkedAt: observedAt, policyVersion: SIRENE_POLICY,
    establishmentDiffusion: str(r.statutDiffusionEtablissement) || "UNKNOWN", legalUnitDiffusion: str(ul.statutDiffusionUniteLegale) || "UNKNOWN" };
  // Opposition checked before touching identifying fields or attempting enrichment.
  if (eligibility.establishmentDiffusion !== "O" || eligibility.legalUnitDiffusion !== "O") eligibility.reason = "diffusion_not_fully_open";
  else if (!/^\d{14}$/.test(externalId)) eligibility.reason = "invalid_siret";
  else if (periods.length !== 1 || current.etatAdministratifEtablissement !== "A") eligibility.reason = "inactive_establishment";
  else if (ul.etatAdministratifUniteLegale !== "A") eligibility.reason = "inactive_legal_unit";
  else if (observedAt.slice(0,10) >= FR_BEAUTY_ACTIVITY_FILTER_V1.expiresAt || nomenclature !== "NAFRev2") eligibility.reason = "unsupported_activity_nomenclature";
  else if (!Object.hasOwn(FR_BEAUTY_ACTIVITY_FILTER_V1.included, code)) eligibility.reason = "outside_beauty_activity_filter";
  else if (str(address.codePaysEtrangerEtablissement) || !/^(?:\d{5}|2[AB]\d{3})$/.test(str(address.codeCommuneEtablissement))) eligibility.reason = "domestic_location_unproven";
  if (eligibility.reason) return { externalId, eligibility };
  const businessName = [current.enseigne1Etablissement, current.denominationUsuelleEtablissement, ul.denominationUsuelle1UniteLegale, ul.denominationUniteLegale].map(str).find(Boolean)
    || [str(ul.prenomUsuelUniteLegale) || str(ul.prenom1UniteLegale), str(ul.nomUsageUniteLegale) || str(ul.nomUniteLegale)].filter(Boolean).join(" ");
  const city = str(address.libelleCommuneEtablissement), postalCode = str(address.codePostalEtablissement);
  const street = [address.numeroVoieEtablissement,address.indiceRepetitionEtablissement,address.typeVoieEtablissement,address.libelleVoieEtablissement].map(str).filter(Boolean).join(" ");
  if (!businessName || !city || !street || !/^\d{5}$/.test(postalCode)) return { externalId, eligibility: { ...eligibility, reason: "establishment_identity_incomplete" } };
  const commune = str(address.codeCommuneEtablissement), department = commune.startsWith("97") || commune.startsWith("98") ? commune.slice(0,3) : commune.slice(0,2);
  eligibility.prospectingEligible = true; eligibility.reason = "active_full_diffusion_beauty";
  const aliasFields: Array<[unknown, BusinessAlias["alias_type"], string]> = [
    ...["enseigne1Etablissement", "enseigne2Etablissement", "enseigne3Etablissement", "denominationUsuelleEtablissement"].map(k => [current[k], "trade_name", `currentPeriod.${k}`] as [unknown, BusinessAlias["alias_type"], string]),
    ...["denominationUsuelle1UniteLegale", "denominationUsuelle2UniteLegale", "denominationUsuelle3UniteLegale"].map(k => [ul[k], "trade_name", `uniteLegale.${k}`] as [unknown, BusinessAlias["alias_type"], string]),
    [ul.denominationUniteLegale, "legal_name", "uniteLegale.denominationUniteLegale"],
  ];
  const business_aliases: BusinessAlias[] = aliasFields.filter(([v]) => str(v)).map(([v, alias_type, evidence]) => ({value: str(v).slice(0,200), alias_type, provider:"sirene", evidence, observed_at:observedAt}));
  if (!business_aliases.length) business_aliases.push({value:businessName,alias_type:"provider_selected_name",provider:"sirene",evidence:"normalized identity; original name field unavailable",observed_at:observedAt});
  return { externalId, eligibility, candidate: { provider: "sirene", country: "FR", externalId, businessName: businessName.slice(0,200), city, postalCode, address: street, department,
    business_aliases,
    activity: { code, nomenclature, label: FR_BEAUTY_ACTIVITY_FILTER_V1.included[code] }, eligibility,
    source: { license: "Licence Ouverte 2.0", attribution: "INSEE — Répertoire Sirene", observedAt, url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${externalId}` } } };
}

export class SireneProvider implements StructuredDiscoveryProvider {
  readonly key = "sirene"; readonly country = "FR";
  async fetchPage(apiKey:string,observedAt:string,cursor:string,fetcher:typeof fetch=fetch) {
    if(!apiKey.trim())throw new Error("sirene_configuration_missing");
    let response:Response;
    try { response=await fetcher(this.query(observedAt.slice(0,10),cursor),{headers:{"X-INSEE-Api-Key-Integration":apiKey.trim(),Accept:"application/json"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(12000)}); }
    catch {throw new Error("sirene_network_failure");}
    if(!response.ok)throw new Error(`sirene_http_${response.status}`);
    return this.normalize(await response.json(),observedAt);
  }
  query(date: string, cursor: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= FR_BEAUTY_ACTIVITY_FILTER_V1.expiresAt || !cursor || cursor.length > 4000) throw new Error("sirene_query_configuration_invalid");
    const url = new URL("https://api.insee.fr/api-sirene/3.11/siret");
    url.search = new URLSearchParams({ q: SIRENE_QUERY, date, nombre: "100", curseur: cursor }).toString();
    return url;
  }
  normalize(payload: unknown, observedAt: string): ProviderPage {
    const root = row(payload);
    if (!Array.isArray(root.etablissements) || root.etablissements.length > 100) throw new Error("sirene_payload_invalid");
    const normalized = root.etablissements.map(r => normalizeSireneEstablishment(r, observedAt));
    return { candidates: normalized.flatMap(r => r.candidate ? [r.candidate] : []), excluded: normalized.filter(r => !r.candidate).map(({externalId,eligibility}) => ({externalId,eligibility})),
      resultCount: normalized.length, nextCursor: str(row(root.header).curseurSuivant) || null };
  }
}
