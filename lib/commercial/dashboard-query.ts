import type { CommercialDashboardFilters, CommercialDateRange } from "./dashboard-read-model-types";

type QueryValue = string | string[] | undefined;
export type CommercialDashboardSearchParams = Record<string, QueryValue>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedRanges = new Set<CommercialDateRange>(["7d", "14d", "30d", "all"]);
const boundedFields = new Set([
  "country", "city", "vertical", "subsegment", "channel", "message_angle",
  "template_version", "priority", "qualification_status", "outreach_status", "sales_status",
]);

function first(value: QueryValue): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function bounded(value: QueryValue, max = 120): string | undefined {
  const result = first(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
  return result || undefined;
}

function positiveInt(value: QueryValue, fallback: number, max: number): number {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function isoDate(value: QueryValue): string | undefined {
  const raw = first(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function parseCommercialDashboardFilters(
  params: CommercialDashboardSearchParams,
  now = new Date(),
): CommercialDashboardFilters {
  const rawRange = first(params.range) as CommercialDateRange;
  const range = allowedRanges.has(rawRange) ? rawRange : "14d";
  const explicitFrom = isoDate(params.date_from);
  const rawDateTo = first(params.date_to);
  let explicitTo = isoDate(params.date_to);
  if (explicitTo && /^\d{4}-\d{2}-\d{2}$/.test(rawDateTo)) {
    explicitTo = new Date(new Date(explicitTo).getTime() + 86_400_000).toISOString();
  }
  const campaign = bounded(params.campaign, 36);
  const result: CommercialDashboardFilters = {
    range,
    page: positiveInt(params.page, 1, 1_000_000),
    pageSize: positiveInt(params.page_size, 25, 100),
  };

  if (campaign && uuidPattern.test(campaign)) result.campaign = campaign;
  for (const field of boundedFields) {
    const value = bounded(params[field]);
    if (!value) continue;
    const camel = field.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()) as keyof CommercialDashboardFilters;
    (result as unknown as Record<string, unknown>)[camel] = value;
  }
  const search = bounded(params.search, 160);
  if (search) result.search = search;

  if (explicitFrom || explicitTo) {
    if (explicitFrom) result.dateFrom = explicitFrom;
    if (explicitTo) result.dateTo = explicitTo;
    return result;
  }

  if (range !== "all") {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 14;
    result.dateFrom = new Date(now.getTime() - days * 86_400_000).toISOString();
    result.dateTo = now.toISOString();
  }
  return result;
}

export function commercialFiltersToRpc(filters: CommercialDashboardFilters): Record<string, string> {
  const rpc: Record<string, string> = {};
  const mappings: Array<[keyof CommercialDashboardFilters, string]> = [
    ["campaign", "campaign"], ["country", "country"], ["city", "city"], ["vertical", "vertical"],
    ["subsegment", "subsegment"], ["channel", "channel"], ["messageAngle", "message_angle"],
    ["templateVersion", "template_version"], ["priority", "priority"],
    ["qualificationStatus", "qualification_status"], ["outreachStatus", "outreach_status"],
    ["salesStatus", "sales_status"], ["search", "search"], ["dateFrom", "date_from"], ["dateTo", "date_to"],
  ];
  for (const [source, target] of mappings) {
    const value = filters[source];
    if (typeof value === "string" && value) rpc[target] = value;
  }
  return rpc;
}
