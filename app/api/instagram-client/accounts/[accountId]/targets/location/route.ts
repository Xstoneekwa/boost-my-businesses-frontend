import { NextResponse } from "next/server";
import { searchGeocodedPlaces } from "@/lib/geocoding/nominatim";
import { readString } from "@/lib/instagram-client/_utils";
import { authorizeClientTargetAiRoute, jsonTargetAiError } from "@/lib/instagram-client/target-ai-route-auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeClientTargetAiRoute(accountId ?? "", { requireAiConfig: false });
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const query = readString(url.searchParams.get("q"), "").trim();
  if (query.length < 2) {
    return NextResponse.json({ ok: true, data: { places: [] } });
  }

  try {
    const places = await searchGeocodedPlaces(query, 6);
    return NextResponse.json({ ok: true, data: { places } });
  } catch {
    return jsonTargetAiError("location_unavailable", 502);
  }
}
