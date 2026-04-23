import type { NextRequest } from "next/server";

export type AnalyticsRole = "superadmin" | "restaurant_client";

export type AnalyticsTenantScope = {
  tenantId: string | null;
  mode: "global" | "tenant";
  role: AnalyticsRole;
};

export function getAnalyticsTenantScope(request: NextRequest): AnalyticsTenantScope {
  const requestedTenantId =
    request.nextUrl.searchParams.get("tenant_id") ||
    request.nextUrl.searchParams.get("tenantId") ||
    null;

  const devRole = process.env.ANALYTICS_DEV_ROLE === "restaurant_client" ? "restaurant_client" : "superadmin";
  const devTenantId = process.env.ANALYTICS_DEV_TENANT_ID || null;

  if (devRole === "restaurant_client") {
    return {
      tenantId: devTenantId,
      mode: devTenantId ? "tenant" : "global",
      role: devRole,
    };
  }

  return {
    tenantId: requestedTenantId,
    mode: requestedTenantId ? "tenant" : "global",
    role: devRole,
  };
}

export function createScopeResponse(scope: AnalyticsTenantScope) {
  return {
    mode: scope.mode,
    tenant_id: scope.tenantId,
    role: scope.role,
  };
}
