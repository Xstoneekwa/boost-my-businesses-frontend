import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AnalyticsCallsOverview = Record<string, unknown>;

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
      .from("analytics_calls_overview")
      .select("*");

    if (role === "tenant") {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query.maybeSingle<AnalyticsCallsOverview>();

    if (error) {
      return NextResponse.json(
        {
          error: "Failed to fetch analytics overview",
          details: error.message,
        },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error: "Analytics overview not found",
          details: "The analytics_calls_overview view returned no rows.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { data, scope: { role, tenant_id: role === "tenant" ? tenantId : null } },
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
        error: "Analytics overview route failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
