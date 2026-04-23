import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AnalyticsIncidentRow = Record<string, unknown>;

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const context = await getDashboardUserContext();

    if (!context) {
      return NextResponse.json(
        { error: "Unauthorized", details: "Sign in to access restaurant analytics." },
        { status: 401 }
      );
    }

    const { role } = context;

    if (role === "tenant") {
      return NextResponse.json(
        { error: "Forbidden", details: "Tenant users cannot access global incident analytics." },
        { status: 403 }
      );
    }

    const query = supabase
      .from("analytics_incidents")
      .select("*");

    const { data, error } = await query.returns<AnalyticsIncidentRow[]>();

    if (error) {
      return NextResponse.json(
        {
          error: "Failed to fetch incident analytics",
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { data: data ?? [], scope: { role, tenant_id: null } },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Incident analytics route failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
