import { NextResponse } from "next/server";
import { readString, rejectTechnicalClientFields } from "@/lib/instagram-client/_utils";
import { authorizeClientTargetAiRoute, jsonTargetAiError } from "@/lib/instagram-client/target-ai-route-auth";
import { searchTargetAccountsWithAi } from "@/lib/instagram-client/target-ai-search-service";

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
  const auth = await authorizeClientTargetAiRoute(accountId ?? "", { requireAiConfig: true });
  if ("error" in auth) return auth.error;

  let body: SearchBody | null = null;
  try {
    body = await request.json() as SearchBody;
  } catch {
    return jsonTargetAiError("invalid_niche", 400);
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) return NextResponse.json({ ok: false, error: technicalError, error_code: "invalid_niche" }, { status: 400 });

  const niche = readString(body?.niche, "").trim();
  if (niche.length < 2) {
    return jsonTargetAiError("invalid_niche", 400);
  }

  const result = await searchTargetAccountsWithAi({
    niche,
    location: readLocation(body?.location),
    maxCandidates: typeof body?.max_candidates === "number" ? body.max_candidates : undefined,
  });

  if (result.status === "no_candidates") {
    return NextResponse.json({
      ok: false,
      error_code: "no_candidates_found",
      error: "No relevant accounts were found.",
      data: {
        status: result.status,
        provider: result.provider,
        candidates: [],
        summary: {
          suggested_count: result.suggested_count,
          verified_count: result.verified_count,
          avatar_resolved: result.avatar_resolved,
          error_code: result.error_code,
          prompt_version: result.debug.prompt_version,
          prompt_source: result.debug.prompt_source,
          found_count: result.debug.found_count,
          eligible_count: result.debug.eligible_count,
          displayed_count: result.debug.displayed_count,
        },
      },
    }, { status: 422 });
  }

  if (result.error_code === "target_ai_provider_error") {
    return jsonTargetAiError("target_ai_provider_error", 503);
  }

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
        prompt_version: result.debug.prompt_version,
        prompt_source: result.debug.prompt_source,
        found_count: result.debug.found_count,
        eligible_count: result.debug.eligible_count,
        displayed_count: result.debug.displayed_count,
      },
    },
  });
}
