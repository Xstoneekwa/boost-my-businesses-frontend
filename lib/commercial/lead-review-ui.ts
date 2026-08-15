import type { CommercialReviewQueueItem } from "./lead-review-contract";

export function commercialReviewLabel(value: string | null) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()) : "—";
}

export function commercialReviewPriorityLabel(value: string) {
  if (value === "urgent") return "P1";
  if (value === "high") return "P2";
  if (value === "normal") return "P3";
  return "P4";
}

export function commercialReviewScore(value: number | null) {
  return value === null ? "—" : (value / 10).toFixed(1);
}

export function commercialReviewDate(value: string | null) {
  if (!value) return "No activity recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No activity recorded";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  }).format(parsed);
}

function contextValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(contextValue).filter(Boolean).slice(0, 8).join(" · ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(contextValue).filter(Boolean).slice(0, 8).join(" · ");
  return "";
}

export function commercialReviewContextEntries(value: Record<string, unknown>) {
  return Object.entries(value).flatMap(([key, raw]) => {
    if (key === "review_note") return [];
    const clean = contextValue(raw);
    return clean ? [{ label: commercialReviewLabel(key), value: clean }] : [];
  }).slice(0, 12);
}

export function commercialReviewNote(value: Record<string, unknown>) {
  return typeof value.review_note === "string" ? value.review_note : "";
}

export function nextCommercialReviewLeadId(items: CommercialReviewQueueItem[], currentId: string | null, direction: 1 | -1) {
  if (!items.length) return null;
  const currentIndex = items.findIndex((item) => item.id === currentId);
  const targetIndex = currentIndex < 0 ? 0 : Math.min(items.length - 1, Math.max(0, currentIndex + direction));
  return items[targetIndex]?.id ?? null;
}

export function safeCommercialReviewUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
