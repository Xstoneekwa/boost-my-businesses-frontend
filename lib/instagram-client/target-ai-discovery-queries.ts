import type { ParsedTargetAiDiscoveryPayload } from "./target-ai-contract.ts";

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export type TargetAiLocationParts = {
  city: string;
  region: string | null;
  country: string | null;
  label: string;
};

export function parseTargetAiLocationParts(locationLabel?: string | null): TargetAiLocationParts {
  const label = locationLabel?.trim() || "";
  const parts = label.split(",").map((entry) => entry.trim()).filter(Boolean);
  return {
    label,
    city: parts[0] || label,
    region: parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[1] : null,
    country: parts.length >= 2 ? parts[parts.length - 1] : null,
  };
}

function queryMentionsLocation(query: string, location: TargetAiLocationParts) {
  const normalized = query.toLowerCase();
  if (location.city && normalized.includes(location.city.toLowerCase())) return true;
  if (location.region && normalized.includes(location.region.toLowerCase())) return true;
  if (location.country && normalized.includes(location.country.toLowerCase())) return true;
  return false;
}

function ensureLocalizedQuery(query: string, location: TargetAiLocationParts, niche: string) {
  const normalized = normalizeQuery(query);
  if (!normalized) return null;
  if (queryMentionsLocation(normalized, location)) return normalized;
  const stripped = normalized.replace(/^site:instagram\.com\s*/i, "").trim();
  if (!stripped) return `site:instagram.com "${niche}" "${location.city}"`;
  return `site:instagram.com ${stripped} "${location.city}"`;
}

function buildLocalizedTemplates(niche: string, location: TargetAiLocationParts, pass: "primary" | "broadened" | "complementary") {
  const templates = [
    `site:instagram.com "${niche}" "${location.city}"`,
    `site:instagram.com ${niche} "${location.city}"`,
  ];
  if (location.region) {
    templates.push(`site:instagram.com "${niche}" "${location.region}"`);
  }
  if (pass !== "primary" && location.country) {
    templates.push(`site:instagram.com "${niche}" "${location.country}"`);
  }
  if (pass === "complementary") {
    templates.push(`site:instagram.com "${location.city}" ${niche}`);
  }
  return templates;
}

export function buildTargetAiDiscoveryQueries(input: {
  niche: string;
  locationLabel?: string | null;
  discovery: ParsedTargetAiDiscoveryPayload;
  pass: "primary" | "broadened" | "complementary";
  maxQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? 10;
  const niche = input.niche.trim();
  const location = parseTargetAiLocationParts(input.locationLabel);
  const hasLocation = Boolean(location.label);
  const seen = new Set<string>();
  const output: string[] = [];

  function push(query: string | null, requireLocation = false) {
    if (!query) return;
    const normalized = normalizeQuery(query);
    if (!normalized) return;
    if (requireLocation && hasLocation && !queryMentionsLocation(normalized, location)) return;
    if (input.pass === "primary" && hasLocation && !queryMentionsLocation(normalized, location)) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  }

  if (hasLocation) {
    for (const template of buildLocalizedTemplates(niche, location, input.pass)) {
      push(template);
    }
  }

  for (const rawQuery of input.discovery.searchQueries) {
    if (hasLocation) {
      push(ensureLocalizedQuery(rawQuery, location, niche));
    } else {
      push(rawQuery);
    }
  }

  for (const angle of input.discovery.searchAngles) {
    const keywords = angle.keywords.filter(Boolean);
    const hashtags = angle.hashtagHints.map((entry) => entry.replace(/^#+/, "")).filter(Boolean);
    const label = angle.label?.trim() || "";

    if (hasLocation) {
      if (keywords.length > 0) {
        push(`site:instagram.com ${keywords.slice(0, 3).join(" ")} "${location.city}"`);
        if (location.region) push(`site:instagram.com ${keywords.slice(0, 2).join(" ")} "${location.region}"`);
      }
      if (hashtags.length > 0) {
        push(`site:instagram.com ${hashtags.slice(0, 2).join(" ")} ${location.city}`);
      }
      if (label) {
        push(`site:instagram.com "${label}" "${location.city}"`);
      }
    } else if (input.pass !== "primary") {
      if (keywords.length > 0) push(`site:instagram.com ${keywords.slice(0, 3).join(" ")} ${niche}`);
    }
  }

  for (const variant of input.discovery.nicheVariants) {
    if (hasLocation) {
      push(`site:instagram.com "${variant}" "${location.city}"`);
      if (input.pass !== "primary" && location.region) {
        push(`site:instagram.com "${variant}" "${location.region}"`);
      }
    } else if (input.pass !== "primary") {
      push(`site:instagram.com ${variant}`);
    }
  }

  if (!hasLocation) {
    push(`site:instagram.com ${niche}`);
  }

  return output.slice(0, maxQueries);
}

export function discoveryQueryRequiresLocation(pass: "primary" | "broadened" | "complementary") {
  return pass === "primary";
}
