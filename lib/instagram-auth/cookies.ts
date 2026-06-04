import { cookies } from "next/headers";
import {
  INSTAGRAM_AUTH_ACCESS_COOKIE,
  INSTAGRAM_AUTH_REFRESH_COOKIE,
} from "@/lib/userContext";

/** Keep Instagram admin cookies aligned with Supabase refresh token lifetime (7 days). */
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

export async function readInstagramAuthCookies(): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const cookieStore = await cookies();
  return {
    accessToken: cookieStore.get(INSTAGRAM_AUTH_ACCESS_COOKIE)?.value ?? "",
    refreshToken: cookieStore.get(INSTAGRAM_AUTH_REFRESH_COOKIE)?.value ?? "",
  };
}

export async function writeInstagramAuthCookies(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const cookieStore = await cookies();
  const options = getInstagramAuthCookieOptions();
  cookieStore.set(INSTAGRAM_AUTH_ACCESS_COOKIE, accessToken, options);
  cookieStore.set(INSTAGRAM_AUTH_REFRESH_COOKIE, refreshToken, options);
}

export async function clearInstagramAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(INSTAGRAM_AUTH_ACCESS_COOKIE);
  cookieStore.delete(INSTAGRAM_AUTH_REFRESH_COOKIE);
}
