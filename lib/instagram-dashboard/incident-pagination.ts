export type IncidentFilter = "open" | "action_required" | "resolved" | "all";

export interface IncidentCursor {
  lastSeenAt: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeIncidentFilter(value: string | null | undefined): IncidentFilter {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "action_required" || normalized === "resolved" || normalized === "all") {
    return normalized;
  }
  return "open";
}

export function encodeIncidentCursor(cursor: IncidentCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeIncidentCursor(value: string | null | undefined): IncidentCursor | null {
  const encoded = String(value ?? "").trim();
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<IncidentCursor>;
    const date = String(parsed.lastSeenAt ?? "").trim();
    const id = String(parsed.id ?? "").trim();
    if (!date || Number.isNaN(Date.parse(date)) || !UUID_RE.test(id)) return null;
    return { lastSeenAt: new Date(date).toISOString(), id };
  } catch {
    return null;
  }
}

export function clampIncidentPageSize(value: number, fallback = 50): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(value)));
}
