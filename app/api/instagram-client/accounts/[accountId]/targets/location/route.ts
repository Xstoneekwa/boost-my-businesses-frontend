import { NextResponse } from "next/server";
import { searchGeocodedPlaces } from "@/lib/geocoding/nominatim";
import { authorizeClientInstagramAccount, readString, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { isClientAiTargetingEnabled } from "@/lib/instagram-client/ai-targeting-gate";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function readAccountPackageCode(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_commercial_packages")
    .select("package_code")
    .eq("account_id", accountId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return "growth";
  return readString((data as { package_code?: unknown } | null)?.package_code, "growth");
}

async function authorizeAiLocationRoute(accountId: string) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return { error: NextResponse.json({ ok: false, error: session.error }, { status: session.status }) };
  }
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) {
    return { error: NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 }) };
  }
  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) {
    return { error: NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status }) };
  }
  const packageCode = await readAccountPackageCode(normalizedAccountId);
  if (!isClientAiTargetingEnabled(packageCode)) {
    return { error: NextResponse.json({ ok: false, error: "AI targeting is not available on your plan." }, { status: 403 }) };
  }
  return { accountId: normalizedAccountId };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAiLocationRoute(accountId ?? "");
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
    return NextResponse.json({ ok: false, error: "location_unavailable" }, { status: 502 });
  }
}
