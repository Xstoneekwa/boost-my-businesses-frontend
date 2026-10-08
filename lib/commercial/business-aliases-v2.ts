/** Provider-neutral source occurrences. Original values and all origins are retained. */
export type BusinessAliasOccurrence = {
  value: string;
  normalized_lookup_value: string;
  alias_type: "LEGAL_NAME" | "ESTABLISHMENT_USUAL_NAME" | "SIGN_NAME" | "LEGAL_UNIT_USUAL_NAME" | "OTHER_PROVIDER_ALIAS";
  provider: string;
  source_field: string;
  observed_at: string;
  source_reference: string;
};

/** Comparison only: never write this normalization back to a provider value. */
export function normalizeAliasLookup(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function groupAliasOccurrences(occurrences: readonly BusinessAliasOccurrence[]) {
  const groups = new Map<string, { value: string; normalized_lookup_value: string; sources: BusinessAliasOccurrence[] }>();
  for (const occurrence of occurrences) {
    const key = normalizeAliasLookup(occurrence.value);
    if (!key || key !== occurrence.normalized_lookup_value) throw new Error("alias_normalization_invalid");
    const group = groups.get(key) ?? { value: occurrence.value, normalized_lookup_value: key, sources: [] };
    group.sources.push({ ...occurrence });
    groups.set(key, group);
  }
  return [...groups.values()];
}
