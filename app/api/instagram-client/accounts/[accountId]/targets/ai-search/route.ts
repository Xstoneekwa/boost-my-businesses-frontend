import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, readString, rejectTechnicalClientFields, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { isClientAiTargetingEnabled } from "@/lib/instagram-client/ai-targeting-gate";
import { searchTargetAccountsWithAi } from "@/lib/instagram-client/target-ai-search-service";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type SearchBody = {
  niche?: string;
  location?: {
    label?: string;
    lat?: number;
    lon?: number;
  } | null;
  max_candidates?: number;
};

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

async function authorizeAiSearchRoute(accountId: string) {
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

function readLocation(body: SearchBody["location"]) {
  if (!body || typeof body !== "object") return null;
  const label = readString(body.label, "").trim();
  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
  const lon = typeof body.lon === "number" && Number.isFinite(body.lon) ? body.lon : null;
  if (!label || lat === null || lon === null) return null;
  return { label, lat, lon };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAiSearchRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  let body: SearchBody | null = null;
  try {
    body = await request.json() as SearchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) return NextResponse.json({ ok: false, error: technicalError }, { status: 400 });

  const niche = readString(body?.niche, "").trim();
  if (niche.length < 2) {
    return NextResponse.json({ ok: false, error: "Niche or keyword is required." }, { status: 400 });
  }

  const result = await searchTargetAccountsWithAi({
    niche,
    location: readLocation(body?.location),
    maxCandidates: typeof body?.max_candidates === "number" ? body.max_candidates : undefined,
  });

  return NextResponse.json({
    ok: true,
    data: {
      status: result.status,
      provider: result.provider,
      candidates: result.candidates,
      summary: {
        suggested_count: result.suggested_count,
        verified_count: result.verified_count,
        avatar_resolved: result.avatar_resolved,
        error_code: result.error_code,
      },
    },
  });
}
