/** Preserve the existing seven-day, host-only HttpOnly cookie contract. */
export const INSTAGRAM_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function getInstagramAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: INSTAGRAM_AUTH_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * The unverified expiry is only a refresh hint, NEVER an authorization decision.
 * Every downstream guard still verifies the user with Supabase and loads DB grants.
 */
export function instagramAccessNeedsRefresh(accessToken: string, now = Date.now()): boolean {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return true;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now + 60_000;
  } catch {
    return true;
  }
}
