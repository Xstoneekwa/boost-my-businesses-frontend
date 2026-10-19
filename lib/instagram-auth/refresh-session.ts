import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RefreshedInstagramAuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
};

/** Temporary Auth outages must fail closed without erasing a usable refresh cookie. */
export function throwIfInstagramAuthUnavailable(error: { status?: number } | null | undefined): void {
  if (error && (!error.status || error.status === 429 || error.status >= 500)) {
    throw new Error("Instagram authentication is temporarily unavailable.");
  }
}

export async function refreshInstagramAuthSession(
  refreshToken: string,
): Promise<RefreshedInstagramAuthSession | null> {
  const normalizedRefresh = refreshToken.trim();
  if (!normalizedRefresh) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: normalizedRefresh,
  });
  throwIfInstagramAuthUnavailable(error);

  const session = data.session;
  const user = data.user;

  if (error || !session?.access_token || !session.refresh_token || !user?.id) {
    return null;
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: user.id,
  };
}
