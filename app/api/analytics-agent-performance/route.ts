import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AnalyticsAgentPerformanceRow = Record<string, unknown>;

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
      .from("analytics_agent_performance")
      .select("*");

    if (role === "tenant") {
      query = query.eq("tenant_id", tenantId);
    }

    const { data, error } = await query.returns<AnalyticsAgentPerformanceRow[]>();

    if (error) {
      return NextResponse.json(
        {
          error: "Failed to fetch agent performance analytics",
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { data: data ?? [], scope: { role, tenant_id: role === "tenant" ? tenantId : null } },
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
        error: "Agent performance analytics route failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
