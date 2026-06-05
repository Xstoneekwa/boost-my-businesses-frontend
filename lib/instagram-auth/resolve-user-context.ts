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

export type ResolveInstagramUserContextOptions = {
  /** When true, refresh/clear cookies (route handlers only). Server Components must keep false. */
  allowCookieMutation?: boolean;
};

/**
 * Resolve Instagram dashboard user context from httpOnly cookies.
 * When the access JWT is expired but the refresh token is valid, refreshes in memory.
 * Cookie writes/clears happen only when `allowCookieMutation` is true (route handlers).
 */
export async function resolveInstagramUserContextFromCookies(
  options: ResolveInstagramUserContextOptions = {},
): Promise<UserContext | null> {
  const { allowCookieMutation = false } = options;
  const { accessToken, refreshToken } = await readInstagramAuthCookies();

  if (!accessToken && !refreshToken) {
    return null;
  }

  let userId = await resolveAuthUserId(accessToken);

  if (!userId && refreshToken) {
    const refreshed = await refreshInstagramAuthSession(refreshToken);
    if (!refreshed) {
      if (allowCookieMutation) {
        await clearInstagramAuthCookies();
      }
      return null;
    }

    userId = refreshed.userId;
    if (allowCookieMutation) {
      await writeInstagramAuthCookies(refreshed.accessToken, refreshed.refreshToken);
    }
  }

  if (!userId) {
    return null;
  }

  return loadTenantUserContext(userId);
}

/** Route-handler helper: resolve context and persist refreshed Supabase session cookies. */
export async function refreshInstagramUserContextFromCookies(): Promise<UserContext | null> {
  return resolveInstagramUserContextFromCookies({ allowCookieMutation: true });
}
