import type { ReactNode } from "react";
import DashboardLayoutShell, { type DashboardWorkspaceMeta } from "@/components/restaurant-analytics/DashboardLayoutShell";
import { requireDashboardUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import type { UserContext } from "@/lib/userContext";

type DashboardRow = Record<string, unknown>;

function readString(row: DashboardRow, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return fallback;
}

function normalizePlan(value: string): DashboardWorkspaceMeta["plan"] {
  const plan = value.trim().toLowerCase();
  if (plan === "premium" || plan === "enterprise") return "premium";
  if (plan === "pro") return "pro";
  return "growth";
}

async function getDashboardWorkspace(userContext: UserContext): Promise<DashboardWorkspaceMeta> {
  try {
    let query = createSupabaseClient().from("restaurant_dashboard_filtered").select("tenant_name, tenant_slug, plan, location_id, location_name");
    if (userContext.role === "tenant") query = query.eq("tenant_id", userContext.tenantId);

    const { data, error } = await query.returns<DashboardRow[]>();
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const locations = rows.map((row, index) => ({
      id: readString(row, ["location_id", "locationId"]) || undefined,
      name: readString(row, ["location_name", "locationName", "name"], `Location ${index + 1}`),
    }));

    return {
      restaurantName: readString(rows[0] ?? {}, ["tenant_name", "tenantName", "name"], userContext.role === "tenant" ? "Restaurant workspace" : "Boost restaurant network"),
      plan: userContext.role === "superadmin" ? "premium" : normalizePlan(readString(rows[0] ?? {}, ["plan"], "growth")),
      locations,
    };
  } catch {
    return {
      restaurantName: userContext.role === "tenant" ? "Restaurant workspace" : "Boost restaurant network",
      plan: userContext.role === "superadmin" ? "premium" : "growth",
      locations: [],
    };
  }
}

export default async function RestaurantAnalyticsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userContext = await requireDashboardUserContext();
  const workspace = await getDashboardWorkspace(userContext);

  return (
    <DashboardLayoutShell userContext={userContext} workspace={workspace}>
      {children}
    </DashboardLayoutShell>
  );
}
