import type { ParsedTargetAiDiscoveryPayload } from "./target-ai-contract.ts";

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function buildTargetAiDiscoveryQueries(input: {
  niche: string;
  locationLabel?: string | null;
  discovery: ParsedTargetAiDiscoveryPayload;
  pass: "primary" | "broadened";
  maxQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? 16;
  const niche = input.niche.trim();
  const location = input.locationLabel?.trim() || null;
  const seen = new Set<string>();
  const output: string[] = [];

  function push(query: string) {
    const normalized = normalizeQuery(query);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  }

  for (const query of input.discovery.searchQueries) push(query);

  for (const angle of input.discovery.searchAngles) {
    const keywords = angle.keywords.filter(Boolean);
    const hashtags = angle.hashtagHints.map((entry) => entry.replace(/^#+/, "")).filter(Boolean);
    const label = angle.label?.trim() || "";

    if (location) {
      if (keywords.length > 0) {
        push(`site:instagram.com ${keywords.slice(0, 3).join(" ")} "${location}"`);
      }
      if (hashtags.length > 0) {
        push(`site:instagram.com ${hashtags.slice(0, 2).join(" ")} ${location}`);
      }
      if (label) {
        push(`site:instagram.com "${label}" "${location}"`);
      }
    }

    if (keywords.length > 0) {
      push(`site:instagram.com ${keywords.slice(0, 3).join(" ")} ${niche}`);
    }
    if (hashtags.length > 0) {
      push(`site:instagram.com #${hashtags.slice(0, 2).join(" #")}`);
    }
  }

  for (const variant of input.discovery.nicheVariants) {
    if (location) push(`site:instagram.com "${variant}" "${location}"`);
    push(`site:instagram.com ${variant}`);
  }

  if (location) {
    push(`site:instagram.com "${niche}" "${location}"`);
    push(`site:instagram.com ${niche} ${location}`);
    if (input.pass === "broadened") {
      push(`site:instagram.com "therapy" "${location}"`);
      push(`site:instagram.com "psychologue" "${location}"`);
    }
  }

  push(`site:instagram.com ${niche}`);

  return output.slice(0, maxQueries);
}
