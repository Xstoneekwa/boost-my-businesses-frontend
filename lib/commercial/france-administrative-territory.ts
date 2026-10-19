/** Administrative observations only, never the requested city or profile text.
 * COG 2026, INSEE communes 75056 / 13055 / 69123 and their municipal arrondissements:
 * https://www.insee.fr/fr/metadonnees/geographie/commune/75056-paris
 * https://www.insee.fr/fr/metadonnees/geographie/commune/13055-marseille
 * https://www.insee.fr/fr/metadonnees/geographie/commune/69123-lyon
 * Paris 16 has two postcodes: https://localiser.laposte.fr/paris/paris/16eme-arrondissement
 * Other communes retain the observed name; no invented national postcode lookup.
 */
export const FR_ADMIN_TERRITORY_RULE = "COG_2026_PLM_OBSERVED_FIELDS_V1";
export const administrativeName = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
type Territory = { rawAdminCity: string; normalizedMatchCity: string | null; rule: string; outcome: "PASS" | "HOLD" | "CONTRADICTION"; reason: string };
const municipalities = [
  { name: "Paris", commune: "75056", department: "75", first: 75101, last: 75120, offset: 75100, postalBase: 75000 },
  { name: "Marseille", commune: "13055", department: "13", first: 13201, last: 13216, offset: 13200, postalBase: 13000 },
  { name: "Lyon", commune: "69123", department: "69", first: 69381, last: 69389, offset: 69380, postalBase: 69000 },
];
export function projectFranceAdministrativeTerritory(input: { libelleCommune: string; commune: string; postalCode: string; department: string }): Territory {
  const rawAdminCity = input.libelleCommune;
  const result = (outcome: Territory["outcome"], reason: string, city: string | null = null): Territory => ({ rawAdminCity, normalizedMatchCity: city, rule: FR_ADMIN_TERRITORY_RULE, outcome, reason });
  if (!rawAdminCity.trim() || !input.commune || !input.postalCode || !input.department) return result("HOLD", "missing_administrative_territory");
  if (!/^(?:\d{5}|2[AB]\d{3})$/.test(input.commune) || !/^\d{5}$/.test(input.postalCode)) return result("HOLD", "invalid_administrative_codes");
  // Overseas collectivities with exceptional postal mappings require a separate documented rule.
  const dep = input.commune.startsWith("97") ? input.commune.slice(0, 3) : input.commune.slice(0, 2);
  if (!/^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-46])$/.test(dep) || dep === "20") return result("HOLD", "unsupported_department_mapping");
  if (dep !== input.department) return result("CONTRADICTION", "commune_department_mismatch");
  const postalDep = /^[0-9]{3}$/.test(dep) ? input.postalCode.slice(0, 3) : input.postalCode.slice(0, 2);
  if (postalDep !== (/^2[AB]$/.test(dep) ? "20" : dep)) return result("CONTRADICTION", "postcode_department_mismatch");
  const name = administrativeName(rawAdminCity);
  if (/^(?:nd|non diffuse|non diffusible|masque|france|inconnu|unknown)$/.test(name)) return result("HOLD", "missing_or_masked_commune_label");
  const byCode = municipalities.find(m => input.commune === m.commune || Number(input.commune) >= m.first && Number(input.commune) <= m.last);
  const byName = municipalities.find(m => name === m.name.toLowerCase() || name.startsWith(`${m.name.toLowerCase()} `));
  if (byCode || byName) {
    if (!byCode || byCode !== byName) return result("CONTRADICTION", "municipal_name_code_mismatch");
    const suffix = name.slice(byCode.name.length).trim();
    const labelNumber = suffix ? /^(\d{1,2})(?:e|er|eme)?(?: arrondissement)?$/.exec(suffix) : null;
    if (suffix && !labelNumber) return result("HOLD", "unrecognized_municipal_label");
    const codeNumber = input.commune === byCode.commune ? null : Number(input.commune) - byCode.offset;
    const arrondissement = labelNumber ? Number(labelNumber[1]) : codeNumber;
    if (labelNumber && codeNumber !== null && Number(labelNumber[1]) !== codeNumber) return result("CONTRADICTION", "arrondissement_label_code_mismatch");
    const last = byCode.last - byCode.offset;
    if (arrondissement !== null && (arrondissement < 1 || arrondissement > last)) return result("CONTRADICTION", "arrondissement_out_of_range");
    const allowed = arrondissement === null
      ? Array.from({ length: last }, (_, i) => String(byCode.postalBase + i + 1))
      : [String(byCode.postalBase + arrondissement)];
    if (byCode.name === "Paris" && (arrondissement === null || arrondissement === 16)) allowed.push("75116");
    if (!allowed.includes(input.postalCode)) return result("CONTRADICTION", "municipal_postcode_mismatch");
    return result("PASS", "documented_municipal_parent", byCode.name);
  }
  // Preserve a generic official commune label, not a target-city substitution.
  if (!/^[\p{L}][\p{L}\p{M} '\-’]+$/u.test(rawAdminCity.trim())) return result("HOLD", "unsupported_commune_label");
  return result("PASS", "observed_commune_department_postcode", rawAdminCity.trim());
}
