import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createUserContextFromTenantUser,
  isUserRole,
  type TenantUserRow,
  type UserContext,
} from "@/lib/userContext";
import {
  clearInstagramAuthCookies,
  readInstagramAuthCookies,
  writeInstagramAuthCookies,
} from "@/lib/instagram-auth/cookies";
import { refreshInstagramAuthSession } from "@/lib/instagram-auth/refresh-session";

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

async function loadTenantUserContext(userId: string): Promise<UserContext | null> {
  const supabase = createSupabaseAdminClient();
  const { data: tenantUser, error: tenantUserError } = await supabase
    .from("tenant_users")
    .select("user_id, tenant_id, role")
    .eq("user_id", userId)
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

async function resolveAuthUserId(accessToken: string): Promise<string | null> {
  if (!accessToken.trim()) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user?.id) {
    return null;
  }

  return userData.user.id;
}

/**
 * Resolve Instagram dashboard user context from httpOnly cookies.
 * Refreshes Supabase session when the access JWT is expired but refresh token is valid.
 */
export async function resolveInstagramUserContextFromCookies(): Promise<UserContext | null> {
  const { accessToken, refreshToken } = await readInstagramAuthCookies();

  if (!accessToken && !refreshToken) {
    return null;
  }

  let effectiveAccessToken = accessToken;
  let effectiveRefreshToken = refreshToken;
  let userId = await resolveAuthUserId(effectiveAccessToken);

  if (!userId && effectiveRefreshToken) {
    const refreshed = await refreshInstagramAuthSession(effectiveRefreshToken);
    if (!refreshed) {
      await clearInstagramAuthCookies();
      return null;
    }

    effectiveAccessToken = refreshed.accessToken;
    effectiveRefreshToken = refreshed.refreshToken;
    userId = refreshed.userId;
    await writeInstagramAuthCookies(effectiveAccessToken, effectiveRefreshToken);
  }

  if (!userId) {
    return null;
  }

  return loadTenantUserContext(userId);
}
