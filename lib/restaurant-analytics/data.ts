import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserContext } from "@/lib/userContext";

export type AnalyticsRow = Record<string, unknown>;

type ScopedFilter = {
  columns: string[];
  value?: string | null;
};

type FetchScopedRowsOptions = {
  supabase: SupabaseClient;
  sources: string[];
  userContext: UserContext;
  filters?: ScopedFilter[];
  limit?: number;
};

const DATE_KEYS = ["created_at", "createdAt", "call_started_at", "started_at", "updated_at", "timestamp", "date"];

export function readNumber(row: AnalyticsRow, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return fallback;
}

export function readString(row: AnalyticsRow, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return fallback;
}

export function readBoolean(row: AnalyticsRow, keys: string[], fallback = false) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "open", "required"].includes(normalized)) return true;
      if (["false", "no", "0", "closed", "resolved"].includes(normalized)) return false;
    }
  }

  return fallback;
}

export function formatInteger(value: number) {
  return Math.round(value).toLocaleString();
}

export function formatPercent(value: number) {
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return `${normalized.toFixed(normalized % 1 === 0 ? 0 : 1)}%`;
}

export function percentOf(part: number, total: number) {
  if (!total) return 0;
  return (part / total) * 100;
}

export function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function readDate(row: AnalyticsRow) {
  const value = readString(row, DATE_KEYS);
  const date = value ? new Date(value) : null;

  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function formatAge(row: AnalyticsRow) {
  const explicitAge = readString(row, ["age", "elapsed", "duration_label", "time_ago"]);
  if (explicitAge) return explicitAge;

  const date = readDate(row);
  if (!date) return "Recent";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));

  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

function isRecoverableSupabaseError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not find the table") ||
    normalized.includes("relation") ||
    normalized.includes("schema cache") ||
    normalized.includes("column") ||
    normalized.includes("does not exist")
  );
}

function buildFilterCombos(filters: ScopedFilter[]) {
  const activeFilters = filters.filter((filter) => filter.value);
  const combos: Array<Array<{ column: string; value: string }>> = [[]];

  for (const filter of activeFilters) {
    const nextCombos: Array<Array<{ column: string; value: string }>> = [];

    for (const combo of combos) {
      for (const column of filter.columns) {
        nextCombos.push([...combo, { column, value: filter.value as string }]);
      }
    }

    combos.splice(0, combos.length, ...nextCombos);
  }

  return combos;
}

function sortRowsByDate(rows: AnalyticsRow[]) {
  return [...rows].sort((a, b) => {
    const dateA = readDate(a)?.getTime() ?? 0;
    const dateB = readDate(b)?.getTime() ?? 0;
    return dateB - dateA;
  });
}

function assertScopedUserContext(userContext: UserContext) {
  if (userContext.role === "tenant" && !userContext.tenantId.trim()) {
    throw new Error("Tenant analytics access requires a tenantId.");
  }
}

export async function fetchScopedRows({
  supabase,
  sources,
  userContext,
  filters = [],
  limit,
}: FetchScopedRowsOptions) {
  assertScopedUserContext(userContext);

  const tenantFilter: ScopedFilter | null =
    userContext.role === "tenant"
      ? { columns: ["tenant_id", "tenantId"], value: userContext.tenantId }
      : null;

  const combos = buildFilterCombos([...(tenantFilter ? [tenantFilter] : []), ...filters]);
  let lastError = "";

  for (const source of sources) {
    for (const combo of combos) {
      let query = supabase.from(source).select("*");

      for (const filter of combo) {
        query = query.eq(filter.column, filter.value);
      }

      const { data, error } = await query.returns<AnalyticsRow[]>();

      if (!error) {
        const rows = sortRowsByDate(data ?? []);
        return typeof limit === "number" ? rows.slice(0, limit) : rows;
      }

      lastError = error.message;

      if (!isRecoverableSupabaseError(error.message)) {
        throw new Error(error.message);
      }
    }
  }

  if (lastError) return [];
  return [];
}

export function sumRows(rows: AnalyticsRow[], keys: string[]) {
  return rows.reduce((sum, row) => sum + readNumber(row, keys), 0);
}

export function averageRows(rows: AnalyticsRow[], keys: string[]) {
  const values = rows
    .map((row) => readNumber(row, keys, Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (!values.length) return 0;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function countByString(rows: AnalyticsRow[], keys: string[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const value = readString(row, keys);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function aggregateRows(rows: AnalyticsRow[]) {
  if (rows.length <= 1) return rows[0] ?? {};

  const aggregate: AnalyticsRow = {};

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (/rate/i.test(key)) continue;

      if (typeof value === "number" && Number.isFinite(value)) {
        aggregate[key] = readNumber(aggregate, [key]) + value;
        continue;
      }

      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);

        if (Number.isFinite(parsed)) {
          aggregate[key] = readNumber(aggregate, [key]) + parsed;
          continue;
        }

        if (!aggregate[key]) aggregate[key] = value;
        continue;
      }

      if (typeof value === "boolean" && aggregate[key] === undefined) {
        aggregate[key] = value;
      }
    }
  }

  return aggregate;
}
