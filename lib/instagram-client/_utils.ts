import { createSupabaseClient } from "@/lib/supabase";
import { canAccessTenantPages, getInstagramUserContext } from "@/lib/restaurant-analytics/session";
import { readBoolean, readString, rejectTechnicalClientFields, clientMaxAccountsLimit } from "./guards";

export type ClientInstagramSession =
  | { ok: true; userId: string; clientId: string }
  | { ok: false; status: number; error: string };

export { readBoolean, readString, rejectTechnicalClientFields, clientMaxAccountsLimit };

export async function requireClientInstagramSession(): Promise<ClientInstagramSession> {
  const context = await getInstagramUserContext();
  if (!context?.userId) {
    return { ok: false, status: 401, error: "Authentication required." };
  }
  if (canAccessTenantPages(context)) {
    return { ok: false, status: 403, error: "Use the admin dashboard to manage accounts." };
  }
  if (!context.tenantId) {
    return { ok: false, status: 403, error: "Client workspace is not linked." };
  }
  return { ok: true, userId: context.userId, clientId: context.tenantId };
}

export async function authorizeClientInstagramAccount(userId: string, accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc("client_can_manage_instagram_account", {
    p_auth_user_id: userId,
    p_account_id: accountId,
  });
  if (error) return { ok: false as const, status: 503, error: "Account ownership check failed." };
  if (!data) return { ok: false as const, status: 403, error: "You are not allowed to manage this account." };
  return { ok: true as const };
}
