import type { StructuredCandidate, BusinessAlias } from "./structured-discovery-contract";
import type { EstablishmentAnchor } from "./profile-first-anchor";
import { administrativeName, projectFranceAdministrativeTerritory } from "./france-administrative-territory";

export const DINUM_PROJECTION_CONTRACT = "DINUM_SIRET_PROJECTION_V1";
/** Pure adapter, NOT a provider/client. Nothing calls this from a worker or route yet.
 * Schema: https://recherche-entreprises.api.gouv.fr/openapi.json (2026).
 * NAFRev2 attribution expires at the published NAF 2025 transition; fail closed then.
 * A future client must bound /search to page 1 and supply the complete counters below.
 */
export type DinumProjectionContext = {
  country: "FR"; requestedCity: string; businessName: string; observedAt: string;
  /** An existing, authorized activity rule's decision, bound to this raw code.
   * No general 12-niche NAF matrix exists here. Missing/unknown => HOLD.
   * The historical POC 96.02A/B filter is deliberately NOT imported/applied.
   */
  activityCompatibility?: { code: string; nomenclature: "NAFRev2"; compatible: boolean; ruleReference: string };
};
export type DinumProjection = {
  matchState: "UNIQUE_MATCH" | "AMBIGUOUS" | "NO_MATCH" | "CONTRADICTION";
  disposition: "ADMITTED" | "HOLD"; reason: string;
  candidate: StructuredCandidate | null; anchor: EstablishmentAnchor | null;
};
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
const safeText = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v.trim() : "";
const validDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?$/.test(v) && Number.isFinite(Date.parse(v));
const missingName = (v: string) => !v || /^(?:nd|non diffuse|non diffusible|masque)$/i.test(administrativeName(v));
const distinctName = (v: string) => v.replace(/[^\p{L}\p{N}]/gu, "").length >= 4 && !/^(?:salon|coiffure|beaute|beauty|clinic|institut|barbier|spa)$/.test(administrativeName(v));
const sameName = (a: string, b: string) => administrativeName(a) === administrativeName(b);
const unresolved = (reason: string, matchState: DinumProjection["matchState"] = "AMBIGUOUS"): DinumProjection => ({ matchState, disposition: "HOLD", reason, candidate: null, anchor: null });
type Examined = { candidate?: StructuredCandidate; reason: string; kind: "MATCH" | "HOLD" | "CONTRADICTION" | "NO_MATCH" };

function examine(legal: Row, est: Row, path: string, context: DinumProjectionContext): Examined {
  const hold = (reason: string): Examined => ({ kind: "HOLD", reason });
  const no = (reason: string): Examined => ({ kind: "NO_MATCH", reason });
  const contradiction = (reason: string): Examined => ({ kind: "CONTRADICTION", reason });
  const commercial = safeText(est.nom_commercial, 240);
  if (est.liste_enseignes != null && (!Array.isArray(est.liste_enseignes) || est.liste_enseignes.some(v => typeof v !== "string"))) return hold("invalid_enseigne_schema");
  const enseignes = (Array.isArray(est.liste_enseignes) ? est.liste_enseignes : []).map(v => safeText(v, 240)).filter(v => !missingName(v));
  // A known but different trade name is a contradiction, not a reason to pick an enseigne.
  const selected = !missingName(commercial) ? commercial : enseignes.find(v => sameName(v, context.businessName));
  if (!selected) return hold("local_trade_name_missing_or_unmatched");
  if (!sameName(selected, context.businessName)) return no("local_trade_name_mismatch");
  if (!distinctName(selected)) return hold("trade_name_not_distinctive");
  const siret = text(est.siret), siren = text(legal.siren);
  if (!/^\d{14}$/.test(siret) || !/^\d{9}$/.test(siren)) return hold("exact_string_siret_siren_required");
  if (!siret.startsWith(siren)) return contradiction("siret_siren_mismatch");
  if (est.statut_diffusion_etablissement !== "O" || legal.statut_diffusion !== "O") return hold("diffusion_not_explicitly_open");
  if (est.etat_administratif !== "A" || legal.etat_administratif !== "A") return hold("active_status_not_proven");
  const territory = projectFranceAdministrativeTerritory({ libelleCommune: safeText(est.libelle_commune, 160) ? text(est.libelle_commune) : "", commune: text(est.commune), postalCode: text(est.code_postal), department: text(est.departement) });
  if (territory.outcome === "CONTRADICTION") return contradiction(territory.reason);
  if (territory.outcome !== "PASS" || !territory.normalizedMatchCity) return hold(territory.reason);
  if (context.requestedCity !== "France" && !sameName(territory.normalizedMatchCity, context.requestedCity)) return contradiction("outside_requested_city");
  const address = safeText(est.adresse, 400);
  if (address.length < 8 || missingName(address) || !/\p{L}/u.test(address)) return hold("address_missing_or_masked");
  const activity = text(est.activite_principale);
  if (!/^\d{2}\.\d{2}[A-Z]$/.test(activity) || context.observedAt >= "2027-01-01") return hold("activity_or_documented_nomenclature_missing");
  const compatibility = context.activityCompatibility;
  if (!compatibility || compatibility.code !== activity || compatibility.nomenclature !== "NAFRev2" || !safeText(compatibility.ruleReference, 160)) return hold("authorized_activity_compatibility_missing");
  if (compatibility.compatible === false) return no("activity_incompatible_under_authorized_rule");
  if (compatibility.compatible !== true) return hold("authorized_activity_compatibility_missing");
  for (const date of [est.date_mise_a_jour_insee, legal.date_mise_a_jour_insee]) if (date != null && !validDate(date)) return hold("invalid_provider_updated_at");
  const legalName = safeText(legal.nom_raison_sociale, 240);
  const aliases: BusinessAlias[] = [];
  const addAlias = (value: string, type: BusinessAlias["alias_type"], field: string) => {
    if (!missingName(value)) aliases.push({ value, alias_type: type, provider: "sirene", evidence: `DINUM:${field}`, observed_at: context.observedAt });
  };
  addAlias(selected, !missingName(commercial) ? "trade_name" : "establishment_name", `${path}.${!missingName(commercial) ? "nom_commercial" : "liste_enseignes"}`);
  enseignes.filter(v => sameName(v, selected) && v !== selected).forEach(v => addAlias(v, "establishment_name", `${path}.liste_enseignes`));
  addAlias(legalName, "legal_name", `${path.split(".matching_etablissements")[0]}.nom_raison_sociale`);
  const legalPath = path.split(".matching_etablissements")[0];
  const fieldPaths = Object.fromEntries(["siret", "nom_commercial", "liste_enseignes", "adresse", "code_postal", "commune", "libelle_commune", "departement", "etat_administratif", "statut_diffusion_etablissement", "activite_principale", "date_mise_a_jour_insee"].filter(f => Object.hasOwn(est, f)).map(f => [f, `${path}.${f}`]));
  for (const field of ["siren", "nom_raison_sociale", "etat_administratif", "statut_diffusion", "date_mise_a_jour_insee"]) if (Object.hasOwn(legal, field)) fieldPaths[`legalUnit.${field}`] = `${legalPath}.${field}`;
  const candidate: StructuredCandidate = {
    provider: "sirene", externalId: siret, country: "FR", businessName: selected,
    address, postalCode: text(est.code_postal),
    // Canonical city is the comparison representation of official fields, NOT requestedCity.
    // Keep the administrative original alongside it in source.lineage.
    city: territory.normalizedMatchCity, department: text(est.departement),
    activity: { code: activity, nomenclature: "NAFRev2", label: "" },
    eligibility: { prospectingEligible: true, reason: "unique_eligible_dinum_establishment", checkedAt: context.observedAt, policyVersion: DINUM_PROJECTION_CONTRACT, establishmentDiffusion: "O", legalUnitDiffusion: "O" },
    source: {
      license: "Licence Ouverte 2.0", attribution: "INSEE — Répertoire Sirene via DINUM — API Recherche d’Entreprises", observedAt: context.observedAt,
      url: `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}`,
      lineage: { delivery_source: "DINUM", canonical_identity_provider: "sirene", siret, siren, fieldPaths,
        providerUpdatedAt: est.date_mise_a_jour_insee == null ? null : text(est.date_mise_a_jour_insee), legalUnitUpdatedAt: legal.date_mise_a_jour_insee == null ? null : text(legal.date_mise_a_jour_insee), observedAt: context.observedAt,
        rawAdminCity: territory.rawAdminCity, normalizedMatchCity: territory.normalizedMatchCity, commune: text(est.commune), territorialRule: territory.rule,
        establishmentState: "A", legalUnitState: "A", activitySource: "DINUM:matching_etablissements.activite_principale / documented NAFRev2 2026 (expires 2027-01-01)", activityCompatibilityRule: compatibility.ruleReference },
    }, business_aliases: aliases,
  };
  return { kind: "MATCH", reason: "eligible_establishment", candidate };
}

/** Raw DINUM schema is deliberately separate from normalizeSireneEstablishment.
 * Missing counters or unexamined results block uniqueness. No pagination/fetch/retry.
 */
export function projectDinumEstablishment(payload: unknown, context: DinumProjectionContext): DinumProjection {
  if (context.country !== "FR" || !safeText(context.requestedCity, 160) || !safeText(context.businessName, 240) || !validDate(context.observedAt)) return unresolved("invalid_projection_context");
  const root = row(payload);
  if (!Array.isArray(root.results) || root.results.length > 25 || root.page !== 1 || !Number.isSafeInteger(root.total_results) || Number(root.total_results) < 0 || !Number.isSafeInteger(root.total_pages) || Number(root.total_pages) < 0) return unresolved("incomplete_or_unbounded_first_page");
  if (Number(root.total_results) !== root.results.length || Number(root.total_pages) > 1 || root.results.length > 0 && root.total_pages !== 1) return unresolved("unexamined_search_results");
  if (!root.results.length) return unresolved("no_establishment_result", "NO_MATCH");
  const examined: Examined[] = [];
  for (const [i, raw] of root.results.entries()) {
    const legal = row(raw);
    if (!Array.isArray(legal.matching_etablissements) || legal.matching_etablissements.length > 100 || !Number.isSafeInteger(legal.nombre_etablissements) || Number(legal.nombre_etablissements) < legal.matching_etablissements.length) return unresolved("incomplete_establishment_set");
    // Conservative: the API only returns matching establishments, never silently use siege.
    if (Number(legal.nombre_etablissements) !== legal.matching_etablissements.length) return unresolved("unexamined_legal_unit_establishments");
    for (const [j, est] of legal.matching_etablissements.entries()) examined.push(examine(legal, row(est), `results[${i}].matching_etablissements[${j}]`, context));
  }
  // A plausible but incomplete result prevents certifying a different one by default.
  const held = examined.find(e => e.kind === "HOLD");
  if (held) return unresolved(held.reason);
  const candidates = examined.flatMap(e => e.candidate ? [e.candidate] : []);
  const bySiret = new Map<string, StructuredCandidate>();
  for (const c of candidates) {
    const previous = bySiret.get(c.externalId);
    if (previous && (previous.businessName !== c.businessName || previous.address !== c.address || previous.city !== c.city || previous.postalCode !== c.postalCode)) return unresolved("same_siret_conflicting_observations", "CONTRADICTION");
    bySiret.set(c.externalId, c);
  }
  const contradicted = examined.find(e => e.kind === "CONTRADICTION");
  if (contradicted) return unresolved(contradicted.reason, "CONTRADICTION");
  if (bySiret.size > 1) return unresolved("multiple_admissible_sirets");
  const candidate = [...bySiret.values()][0];
  if (!candidate) return unresolved(examined[0]?.reason ?? "no_local_establishment", "NO_MATCH");
  return { matchState: "UNIQUE_MATCH", disposition: "ADMITTED", reason: "unique_eligible_dinum_establishment", candidate,
    anchor: { candidate, provenance: { kind: "STRUCTURED_ESTABLISHMENT", provider: "sirene", reference: candidate.source.url, observedAt: context.observedAt, derivedFrom: ["https://recherche-entreprises.api.gouv.fr/", candidate.source.url] }, legalId: { type: "SIRET", value: candidate.externalId, exact: true } } };
}
