import { parseTargetAiLocationParts } from "./target-ai-discovery-queries.ts";

export const TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS_SHORT = [
  "-inurl:/p/",
  "-inurl:/explore",
] as const;

export const TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS = [
  ...TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS_SHORT,
  "-inurl:/reel/",
  "-inurl:/stories",
  "-inurl:/tv/",
  "-inurl:/direct/",
  "-inurl:/accounts/",
] as const;

const CITY_DISTRICTS: Record<string, string[]> = {
  johannesburg: ["Sandton", "Rosebank", "Randburg", "Braamfontein", "Melville", "Midrand", "Fourways"],
  bordeaux: ["Mérignac", "Pessac", "Talence", "Bègles"],
  pretoria: ["Centurion", "Menlyn", "Brooklyn"],
};

const COUNTRY_MAJOR_CITIES: Record<string, string[]> = {
  belgique: ["Bruxelles", "Brussels", "Antwerpen", "Antwerp", "Gent", "Ghent", "Liège"],
  belgium: ["Bruxelles", "Brussels", "Antwerpen", "Antwerp", "Gent", "Ghent", "Liège"],
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
    variants.add("chinese food");
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
    variants.add("clinical psychologist");
    variants.add("therapy");
    variants.add("therapist");
    variants.add("counselling");
    variants.add("mental health");
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

function readLocationPhrases(locationLabel?: string | null) {
  const location = parseTargetAiLocationParts(locationLabel);
  const phrases = new Set<string>();
  if (location.city) phrases.add(location.city);
  if (location.region && location.region !== location.city) phrases.add(location.region);
  if (location.country) phrases.add(location.country);
  if (location.label) phrases.add(location.label);

  const countryKey = normalizeKey(location.country || location.city || location.label);
  for (const city of COUNTRY_MAJOR_CITIES[countryKey] ?? []) {
    phrases.add(city);
  }

  if (location.city) {
    for (const district of CITY_DISTRICTS[normalizeKey(location.city)] ?? []) {
      phrases.add(district);
    }
  }

  return [...phrases].filter(Boolean);
}

function buildGoogleInstagramQuery(input: {
  locationPhrase: string;
  nicheParts: string[];
  includeSiteInternet?: boolean;
  shortExclusions?: boolean;
}) {
  const parts = [`"${input.locationPhrase}"`];
  for (const part of input.nicheParts) {
    parts.push(`"${part}"`);
  }
  if (input.includeSiteInternet) parts.push('"site internet"');
  parts.push("site:instagram.com");
  parts.push(...(input.shortExclusions ? TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS_SHORT : TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS));
  return parts.join(" ");
}

function readNicheQueryForms(niche: string) {
  const normalized = niche.trim().toLowerCase();
  const forms: string[][] = [[niche.trim()]];
  if (normalized.includes("restaurant") && (normalized.includes("chinois") || normalized.includes("asiatique"))) {
    forms.push(["restaurant", normalized.includes("chinois") ? "chinois" : "asiatique"]);
  }
  return forms;
}

export function buildTargetAiGoogleQueries(input: {
  niche: string;
  locationLabel?: string | null;
  maxQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? 22;
  const niche = input.niche.trim();
  const nicheVariants = readNicheVariants(niche);
  const nicheForms = readNicheQueryForms(niche);
  const locationPhrases = readLocationPhrases(input.locationLabel);
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

  for (const locationPhrase of locationPhrases) {
    for (const nicheParts of nicheForms) {
      push(buildGoogleInstagramQuery({ locationPhrase, nicheParts, includeSiteInternet: true, shortExclusions: true }));
      push(buildGoogleInstagramQuery({ locationPhrase, nicheParts, includeSiteInternet: false, shortExclusions: true }));
    }
    for (const nichePhrase of nicheVariants) {
      push(buildGoogleInstagramQuery({ locationPhrase, nicheParts: [nichePhrase], includeSiteInternet: true, shortExclusions: true }));
      push(buildGoogleInstagramQuery({ locationPhrase, nicheParts: [nichePhrase], includeSiteInternet: false, shortExclusions: true }));
      push(buildGoogleInstagramQuery({ locationPhrase, nicheParts: [nichePhrase], includeSiteInternet: false, shortExclusions: false }));
    }
  }

  if (locationPhrases.length === 0) {
    for (const nichePhrase of nicheVariants) {
      push(`"${nichePhrase}" site:instagram.com ${TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS_SHORT.join(" ")}`);
    }
  }

  return output.slice(0, maxQueries);
}

export function buildTargetAiManualBenchmarkQueries(input: {
  niche: string;
  locationLabel?: string | null;
}) {
  const niche = input.niche.trim().toLowerCase();
  const location = parseTargetAiLocationParts(input.locationLabel);
  const city = (location.city || location.label || "").trim();
  const cityLower = city.toLowerCase();

  if (cityLower.includes("johannesburg") && niche.includes("restaurant") && niche.includes("chinois")) {
    return [
      `"${city}" "restaurant" "chinois" "site internet" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "restaurant chinois" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "chinese restaurant" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "chinese food" site:instagram.com -inurl:/p/ -inurl:/explore`,
    ];
  }

  if (cityLower.includes("bordeaux") && niche.includes("restaurant") && niche.includes("asiatique")) {
    return [
      `"${city}" "restaurant" "asiatique" "site internet" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "restaurant asiatique" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "restaurant chinois" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "ramen" site:instagram.com -inurl:/p/ -inurl:/explore`,
    ];
  }

  if (cityLower.includes("johannesburg") && niche.includes("psycholog")) {
    return [
      `"${city}" "psychologist" "site internet" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "clinical psychologist" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "therapy" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"${city}" "counselling" site:instagram.com -inurl:/p/ -inurl:/explore`,
    ];
  }

  if ((cityLower.includes("belg") || location.country?.toLowerCase().includes("belg")) && niche.includes("social media")) {
    return [
      `"belgique" "agence social media" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"belgium" "social media agency" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"bruxelles" "agence social media" site:instagram.com -inurl:/p/ -inurl:/explore`,
      `"brussels" "social media agency" site:instagram.com -inurl:/p/ -inurl:/explore`,
    ];
  }

  return buildTargetAiGoogleQueries({ niche: input.niche, locationLabel: input.locationLabel, maxQueries: 8 });
}

export function formatTargetAiGoogleQueryExample(input: {
  niche: string;
  locationLabel?: string | null;
}) {
  return buildTargetAiGoogleQueries({ ...input, maxQueries: 6 });
}
