import { parseTargetAiLocationParts } from "./target-ai-discovery-queries.ts";

export const TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS = [
  "-inurl:/p/",
  "-inurl:/reel/",
  "-inurl:/explore",
  "-inurl:/stories",
  "-inurl:/tv/",
  "-inurl:/direct/",
  "-inurl:/accounts/",
  "-inurl:/about/",
  "-inurl:/developer/",
  "-inurl:/business/",
  "-inurl:/legal/",
] as const;

const CITY_DISTRICTS: Record<string, string[]> = {
  johannesburg: ["Sandton", "Rosebank", "Midrand", "Fourways", "Soweto"],
  bordeaux: ["Mérignac", "Pessac", "Talence", "Bègles"],
  pretoria: ["Centurion", "Menlyn", "Brooklyn"],
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function readNicheVariants(niche: string) {
  const normalized = niche.trim().toLowerCase();
  const variants = new Set<string>([niche.trim()]);

  if (normalized.includes("restaurant") && normalized.includes("chinois")) {
    variants.add("restaurant chinois");
    variants.add("chinese restaurant");
    variants.add("chinese takeaway");
    variants.add("asian restaurant");
  } else if (normalized.includes("restaurant") && normalized.includes("asiatique")) {
    variants.add("restaurant asiatique");
    variants.add("restaurant chinois");
    variants.add("restaurant japonais");
    variants.add("restaurant thaï");
    variants.add("ramen");
    variants.add("sushi");
    variants.add("asian restaurant");
  } else if (normalized.includes("psycholog")) {
    variants.add("psychologue");
    variants.add("psychologist");
    variants.add("therapy");
    variants.add("therapist");
    variants.add("mental health");
    variants.add("counselling");
  } else if (normalized.includes("social media") || normalized.includes("agence")) {
    variants.add("agence social media");
    variants.add("social media agency");
    variants.add("marketing agency");
    variants.add("digital agency");
    variants.add("community management");
  } else {
    variants.add(niche.trim());
  }

  return [...variants].filter(Boolean);
}

function buildGoogleInstagramQuery(input: {
  locationPhrase: string;
  nichePhrase: string;
  includeSiteInternet?: boolean;
}) {
  const parts = [
    `"${input.locationPhrase}"`,
    `"${input.nichePhrase}"`,
  ];
  if (input.includeSiteInternet) parts.push('"site internet"');
  parts.push("site:instagram.com", ...TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS);
  return parts.join(" ");
}

export function buildTargetAiGoogleQueries(input: {
  niche: string;
  locationLabel?: string | null;
  maxQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? 18;
  const niche = input.niche.trim();
  const location = parseTargetAiLocationParts(input.locationLabel);
  const nicheVariants = readNicheVariants(niche);
  const seen = new Set<string>();
  const output: string[] = [];

  function push(query: string) {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  }

  const locationPhrases: string[] = [];
  if (location.city) locationPhrases.push(location.city);
  if (location.region && location.region !== location.city) locationPhrases.push(location.region);
  if (location.country && !locationPhrases.includes(location.country)) locationPhrases.push(location.country);
  if (locationPhrases.length === 0 && location.label) locationPhrases.push(location.label);

  for (const locationPhrase of locationPhrases) {
    for (const nichePhrase of nicheVariants.slice(0, 6)) {
      push(buildGoogleInstagramQuery({ locationPhrase, nichePhrase, includeSiteInternet: true }));
      push(buildGoogleInstagramQuery({ locationPhrase, nichePhrase, includeSiteInternet: false }));
    }
  }

  if (location.city) {
    const districts = CITY_DISTRICTS[normalizeKey(location.city)] ?? [];
    for (const district of districts.slice(0, 4)) {
      for (const nichePhrase of nicheVariants.slice(0, 3)) {
        push(buildGoogleInstagramQuery({ locationPhrase: district, nichePhrase, includeSiteInternet: false }));
      }
    }
  }

  if (locationPhrases.length === 0) {
    for (const nichePhrase of nicheVariants) {
      push(`"${nichePhrase}" "site internet" site:instagram.com ${TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS.join(" ")}`);
    }
  }

  return output.slice(0, maxQueries);
}

export function formatTargetAiGoogleQueryExample(input: {
  niche: string;
  locationLabel?: string | null;
}) {
  return buildTargetAiGoogleQueries({ ...input, maxQueries: 6 });
}
