import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { enrichLocationNames } from "@/lib/restaurant-analytics/name-enrichment";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AnalyticsLocationRow = Record<string, unknown>;

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

    const { role, tenantId } = context;

    let query = supabase
      .from("analytics_calls_by_location")
      .select("*");

    if (role === "tenant") {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query.returns<AnalyticsLocationRow[]>();

    if (error) {
      return NextResponse.json(
        {
          error: "Failed to fetch location analytics",
          details: error.message,
        },
        { status: 500 }
      );
    }

    const rows = await enrichLocationNames(supabase, data ?? []);

    return NextResponse.json(
      { data: rows, scope: { role, tenant_id: role === "tenant" ? tenantId : null } },
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
        error: "Location analytics route failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
