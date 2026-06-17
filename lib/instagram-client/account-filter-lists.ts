import { normalizeTargetUsername, isValidTargetUsername } from "../instagram-targets.ts";

export function parseAccountFilterList(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  if (!raw.trim()) return [];
  return raw
    .split(/[\n,;]+/)
    .map((item) => normalizeTargetUsername(item.trim()))
    .filter(Boolean);
}

export function serializeAccountFilterList(items: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of items) {
    const username = normalizeTargetUsername(item);
    if (!username || !isValidTargetUsername(username) || seen.has(username)) continue;
    seen.add(username);
    normalized.push(username);
  }
  return normalized.join("\n");
}

export function normalizeAccountFilterListInput(items: unknown) {
  if (!Array.isArray(items)) return [];
  return serializeAccountFilterList(items.map((item) => String(item ?? "")).filter(Boolean))
    .split("\n")
    .filter(Boolean);
}
