import { NextRequest, NextResponse } from "next/server";
import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createUserContextFromTenantUser, isUserRole, type UserContext } from "@/lib/userContext";

type AnalyticsRow = Record<string, unknown>;

const DATE_FILTER_COLUMNS = ["period_start", "period_date", "date", "day", "call_date", "created_at", "started_at"] as const;
const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function getDateRangeStart(range: string) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[range] ?? 30));
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

function isMissingDateColumnError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") || normalized.includes("schema cache") || normalized.includes("does not exist");
}

function readValue(row: AnalyticsRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function escapeCsv(value: string) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: AnalyticsRow[], headers: string[]) {
  return [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(readValue(row, header))).join(",")),
  ].join("\n");
}

function withExportContext(rows: AnalyticsRow[], range: string) {
  return rows.map((row) => {
    const sms = readExportNumber(row, "sms_followups_sent") ?? 0;
    const whatsapp = readExportNumber(row, "whatsapp_followups_sent") ?? 0;

    return {
      export_range: range,
      ...row,
      total_followups: sms + whatsapp,
    };
  });
}

function readExportNumber(row: AnalyticsRow, key: string) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function getBearerUserContext(request: NextRequest): Promise<UserContext | null> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) return null;

  const supabase = createSupabaseAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData.user) return null;

  const { data: tenantUser, error: tenantUserError } = await supabase
    .from("tenant_users")
    .select("user_id, tenant_id, role")
    .eq("user_id", userData.user.id)
    .maybeSingle<{ user_id?: unknown; tenant_id?: unknown; role?: unknown }>();

  if (tenantUserError || !tenantUser || typeof tenantUser.user_id !== "string" || !isUserRole(tenantUser.role)) {
    return null;
  }

  return createUserContextFromTenantUser({
    user_id: tenantUser.user_id,
    tenant_id: typeof tenantUser.tenant_id === "string" && tenantUser.tenant_id.trim() ? tenantUser.tenant_id : null,
    role: tenantUser.role,
  });
}

async function fetchDashboardRows(request: NextRequest, range: string) {
  const userContext = (await getBearerUserContext(request)) ?? (await getDashboardUserContext());
  if (!userContext) return { ok: false as const, status: 401, error: "Unauthorized" };

  const since = getDateRangeStart(range);
  const supabase = createSupabaseClient();
  let lastError = "";

  for (const column of DATE_FILTER_COLUMNS) {
    let query = supabase.from("restaurant_dashboard_filtered").select("*").gte(column, since);
    if (userContext.role === "tenant") query = query.eq("tenant_id", userContext.tenantId);

    const result = await query.returns<AnalyticsRow[]>();
    if (!result.error) return { ok: true as const, rows: result.data ?? [] };

    lastError = result.error.message;
    if (!isMissingDateColumnError(result.error.message)) {
      return { ok: false as const, status: 500, error: result.error.message };
    }
  }

  let fallbackQuery = supabase.from("restaurant_dashboard_filtered").select("*");
  if (userContext.role === "tenant") fallbackQuery = fallbackQuery.eq("tenant_id", userContext.tenantId);
  const fallback = await fallbackQuery.returns<AnalyticsRow[]>();

  if (fallback.error) return { ok: false as const, status: 500, error: lastError || fallback.error.message };
  return { ok: true as const, rows: fallback.data ?? [] };
}

export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get("range") ?? "30d";
  const result = await fetchDashboardRows(request, range);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const headers = [
    "export_range",
    "tenant_id",
    "tenant_name",
    "tenant_slug",
    "plan",
    "location_id",
    "location_name",
    "total_calls",
    "total_reservations",
    "total_escalations",
    "call_to_booking_rate",
    "quota_usage_percent",
    "sms_followups_sent",
    "whatsapp_followups_sent",
    "total_followups",
    "failed_followups",
    "estimated_revenue_eur",
    "estimated_revenue_zar",
    "estimated_followup_recovered_revenue_eur",
    "estimated_followup_recovered_revenue_zar",
  ];
  const csv = toCsv(withExportContext(result.rows, range), headers);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="restaurant-dashboard-${range}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
