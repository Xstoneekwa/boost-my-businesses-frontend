export type ClientEmailHistorySearchMode = "exact" | "partial";

export type NormalizedClientEmailFilter = {
  mode: ClientEmailHistorySearchMode;
  value: string;
};

export function normalizeClientEmailFilter(raw: string): NormalizedClientEmailFilter | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
    return { mode: "exact", value: lower };
  }

  const compact = lower.replace(/\s+/g, "");
  if (compact.length < 2) return null;
  return { mode: "partial", value: compact };
}

export function recipientEmailMatchesFilter(
  recipientEmail: string,
  filter: NormalizedClientEmailFilter,
) {
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  if (!normalizedRecipient) return false;
  if (filter.mode === "exact") return normalizedRecipient === filter.value;
  return normalizedRecipient.includes(filter.value);
}
