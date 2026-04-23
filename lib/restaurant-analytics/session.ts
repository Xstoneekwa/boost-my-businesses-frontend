import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  RESTAURANT_AUTH_ACCESS_COOKIE,
  createUserContextFromTenantUser,
  isUserRole,
  type TenantUserRow,
  type UserContext,
} from "@/lib/userContext";

type TenantUserRecord = {
  user_id?: unknown;
  tenant_id?: unknown;
  role?: unknown;
};

function normalizeTenantUser(row: TenantUserRecord): TenantUserRow | null {
  if (typeof row.user_id !== "string" || !isUserRole(row.role)) {
    return null;
  }

  return {
    user_id: row.user_id,
    tenant_id: typeof row.tenant_id === "string" && row.tenant_id.trim() ? row.tenant_id : null,
    role: row.role,
  };
}

export async function getDashboardUserContext(): Promise<UserContext | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(RESTAURANT_AUTH_ACCESS_COOKIE)?.value;

  if (!accessToken) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !userData.user) {
    return null;
  }

  const { data: tenantUser, error: tenantUserError } = await supabase
    .from("tenant_users")
    .select("user_id, tenant_id, role")
    .eq("user_id", userData.user.id)
    .maybeSingle<TenantUserRecord>();

  if (tenantUserError || !tenantUser) {
    return null;
  }

  const normalizedTenantUser = normalizeTenantUser(tenantUser);

  if (!normalizedTenantUser) {
    return null;
  }

  return createUserContextFromTenantUser(normalizedTenantUser);
}

export async function requireDashboardUserContext(): Promise<UserContext> {
  const context = await getDashboardUserContext();

  if (!context) {
    redirect("/restaurant-login");
  }

  return context;
}

export function canAccessTenantPages(context: UserContext) {
  return context.role === "superadmin";
}
