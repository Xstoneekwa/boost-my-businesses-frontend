import { normalizeSireneEstablishment } from "./sirene-provider";
import { normalizeAliasLookup, type BusinessAliasOccurrence } from "./business-aliases-v2";

export const SIRENE_DETAIL_BASE = "https://api.insee.fr/api-sirene/3.11/siret/";
export const SIRENE_ALIAS_MAPPING_VERSION = "OFFICIAL_INSEE_API_3_11_V3A";
type Row = Record<string, unknown>;
const object = (v: unknown): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const periodNames = ["denominationUsuelleEtablissement", "enseigne1Etablissement", "enseigne2Etablissement", "enseigne3Etablissement"];
const legalNames = ["denominationUniteLegale", "denominationUsuelle1UniteLegale", "denominationUsuelle2UniteLegale", "denominationUsuelle3UniteLegale"];
export class SireneSchemaError extends Error {
  constructor(readonly mismatches: string[]) { super("sirene_live_schema_mismatch"); }
}

/** Schema-only assertions: errors contain paths, never response values or credentials. */
export function validateSireneDetail(payload: unknown, siret: string) {
  const errors: string[] = [];
  if (!object(payload) || !object(payload.header) || payload.header.statut !== 200 || !object(payload.etablissement)) {
    throw new SireneSchemaError(["response.header_or_etablissement"]);
  }
  const establishment = payload.etablissement;
  if (establishment.siret !== siret) errors.push("etablissement.siret_exact_match");
  if (typeof establishment.statutDiffusionEtablissement !== "string") errors.push("statutDiffusionEtablissement:string");
  const ul = establishment.uniteLegale;
  if (!object(ul)) throw new SireneSchemaError([...errors, "uniteLegale:object"]);
  for (const key of ["statutDiffusionUniteLegale", "etatAdministratifUniteLegale"]) {
    if (typeof ul[key] !== "string") errors.push(`uniteLegale.${key}:string`);
  }
  const periods = establishment.periodesEtablissement;
  if (!Array.isArray(periods) || periods.some(p => !object(p) || !(p.dateFin === null || (typeof p.dateFin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.dateFin))))) {
    throw new SireneSchemaError([...errors, "periodesEtablissement:dated_object_array"]);
  }
  const current = periods.filter(p => p.dateFin === null);
  if (current.length !== 1) throw new SireneSchemaError([...errors, "periodesEtablissement:exactly_one_current"]);
  const period = current[0] as Row;
  for (const key of ["etatAdministratifEtablissement", "activitePrincipaleEtablissement", "nomenclatureActivitePrincipaleEtablissement"]) {
    if (typeof period[key] !== "string") errors.push(`currentPeriod.${key}:string`);
  }
  for (const [scope, fields, prefix] of [[period, periodNames, "currentPeriod"], [ul, legalNames, "uniteLegale"]] as const) {
    for (const key of fields) if (scope[key] !== undefined && scope[key] !== null && (typeof scope[key] !== "string" || (scope[key] as string).length > 1000)) errors.push(`${prefix}.${key}:nullable_string`);
  }
  const address = establishment.adresseEtablissement;
  if (!object(address)) errors.push("adresseEtablissement:object");
  else for (const key of ["codeCommuneEtablissement", "codePostalEtablissement", "libelleCommuneEtablissement", "numeroVoieEtablissement", "indiceRepetitionEtablissement", "typeVoieEtablissement", "libelleVoieEtablissement", "codePaysEtrangerEtablissement"]) {
    if (address[key] !== undefined && address[key] !== null && typeof address[key] !== "string") errors.push(`adresseEtablissement.${key}:nullable_string`);
  }
  if (errors.length) throw new SireneSchemaError(errors);
  return { establishment, period, ul };
}

export function parseSireneAliases(payload: unknown, siret: string, observedAt: string) {
  const { establishment, period, ul } = validateSireneDetail(payload, siret);
  const normalized = normalizeSireneEstablishment(establishment, observedAt);
  // No alias extraction before both gates pass; raw payload is never returned.
  if (!normalized.eligibility.prospectingEligible) return { schema: "PASS" as const, eligibility: normalized.eligibility, aliases: [] as BusinessAliasOccurrence[], observedAt, mappingVersion: SIRENE_ALIAS_MAPPING_VERSION };
  const aliases: BusinessAliasOccurrence[] = [];
  const add = (value: unknown, field: string, type: BusinessAliasOccurrence["alias_type"]) => {
    if (typeof value !== "string" || !value.trim() || value.trim() === "[ND]" || !normalizeAliasLookup(value)) return;
    aliases.push({ value, normalized_lookup_value: normalizeAliasLookup(value), alias_type: type, provider: "sirene", source_field: field, observed_at: observedAt, source_reference: `${SIRENE_DETAIL_BASE}${siret}` });
  };
  // Each sign line is a source occurrence, never a concatenated/reconstructed name.
  for (const key of periodNames) add(period[key], `periodesEtablissement[dateFin=null].${key}`, key === "denominationUsuelleEtablissement" ? "ESTABLISHMENT_USUAL_NAME" : "SIGN_NAME");
  for (const key of legalNames) add(ul[key], `uniteLegale.${key}`, key === "denominationUniteLegale" ? "LEGAL_NAME" : "LEGAL_UNIT_USUAL_NAME");
  return { schema: "PASS" as const, eligibility: normalized.eligibility, aliases, observedAt, mappingVersion: SIRENE_ALIAS_MAPPING_VERSION };
}
export type SireneAliasResult = ReturnType<typeof parseSireneAliases>;
