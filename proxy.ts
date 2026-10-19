import { NextRequest, NextResponse } from "next/server";
import { refreshInstagramAuthSession } from "@/lib/instagram-auth/refresh-session";
import { getInstagramAuthCookieOptions, instagramAccessNeedsRefresh } from "@/lib/instagram-auth/session-policy";
import { INSTAGRAM_AUTH_ACCESS_COOKIE, INSTAGRAM_AUTH_REFRESH_COOKIE } from "@/lib/userContext";

/** Refresh transport only. Page/API role, tenant and Commercial grant checks remain authoritative. */
export async function proxy(request: NextRequest) {
  const access = request.cookies.get(INSTAGRAM_AUTH_ACCESS_COOKIE)?.value ?? "";
  const refresh = request.cookies.get(INSTAGRAM_AUTH_REFRESH_COOKIE)?.value ?? "";
  if (!refresh || !instagramAccessNeedsRefresh(access)) return NextResponse.next();

  try {
    const session = await refreshInstagramAuthSession(refresh);
    if (!session) {
      const response = request.nextUrl.pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Instagram session expired or invalid." }, { status: 401 })
        : request.nextUrl.pathname === "/instagram-login"
          ? NextResponse.next()
          : NextResponse.redirect(new URL("/instagram-login", request.url));
      response.cookies.set(INSTAGRAM_AUTH_ACCESS_COOKIE, "", { ...getInstagramAuthCookieOptions(), maxAge: 0 });
      response.cookies.set(INSTAGRAM_AUTH_REFRESH_COOKIE, "", { ...getInstagramAuthCookieOptions(), maxAge: 0 });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }

    // Both this render and the browser's next request must receive the rotated pair.
    request.cookies.set(INSTAGRAM_AUTH_ACCESS_COOKIE, session.accessToken);
    request.cookies.set(INSTAGRAM_AUTH_REFRESH_COOKIE, session.refreshToken);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(INSTAGRAM_AUTH_ACCESS_COOKIE, session.accessToken, getInstagramAuthCookieOptions());
    response.cookies.set(INSTAGRAM_AUTH_REFRESH_COOKIE, session.refreshToken, getInstagramAuthCookieOptions());
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    // No token logging or cookie clearing on network/rate-limit/provider outages.
    return NextResponse.json(
      { error: "Instagram authentication is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export const config = {
  matcher: ["/instagram-login", "/instagram-dashboard/:path*", "/instagram-client/:path*", "/api/instagram-dashboard/:path*"],
};
