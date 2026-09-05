import type { NextRequest } from "next/server";
import { CONSENT_COOKIE, parseConsent } from "@/lib/marketing/consent";
import { GTM_CONTAINER_ID } from "@/lib/marketing/gtm";

export function GET(request: NextRequest) {
  const choice = parseConsent(request.cookies.get(CONSENT_COOKIE)?.value);
  const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", Vary: "Cookie" };
  // Without JS, selective Consent Mode cannot execute. No Google request unless
  // ALL categories have a valid, explicit prior grant. Never cached across users.
  if (!choice?.analytics || !choice.ads) return new Response(null, { status: 204, headers });
  return new Response(null, { status: 302, headers: { ...headers, Location: `https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}` } });
}
