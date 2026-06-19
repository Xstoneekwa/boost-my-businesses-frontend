import { normalizeTargetAiLocation } from "./target-ai-location-normalize.ts";

function normalizeKey(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function nicheIncludes(value: string, ...needles: string[]) {
  const key = normalizeKey(value);
  return needles.every((needle) => key.includes(normalizeKey(needle)));
}

function locationIncludesJohannesburg(locationLabel?: string | null) {
  const normalized = normalizeTargetAiLocation(locationLabel);
  const tokens = normalized.tokens.map((token) => normalizeKey(token));
  return tokens.some((token) => token.includes("johannesburg") || token === "jhb");
}

export function readTargetAiHarnessLooseQueries(input: {
  niche: string;
  locationLabel?: string | null;
}) {
  if (nicheIncludes(input.niche, "restaurant", "chinois") && locationIncludesJohannesburg(input.locationLabel)) {
    return [
      '"johannesburg" "chinese restaurant" instagram',
      '"johannesburg" "chinese food" instagram',
      '"johannesburg" "chinese takeaway" instagram',
      '"johannesburg" "dim sum" instagram',
      '"johannesburg" "dumplings" instagram',
      '"johannesburg" "noodles" instagram',
      '"johannesburg" "asian restaurant" instagram',
      '"johannesburg" "halaal chinese" instagram',
      '"sandton" "chinese restaurant" instagram',
      '"sandton" "dim sum" instagram',
      '"rosebank" "asian restaurant" instagram',
      '"randburg" "chinese takeaway" instagram',
      '"fourways" "chinese restaurant" instagram',
      '"melrose" "asian restaurant" instagram',
      '"norwood" "chinese restaurant" instagram',
    ];
  }

  return null;
}
