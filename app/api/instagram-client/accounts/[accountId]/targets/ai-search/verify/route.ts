import { NextResponse } from "next/server";
import { readString, rejectTechnicalClientFields } from "@/lib/instagram-client/_utils";
import { authorizeClientTargetAiRoute, jsonTargetAiError } from "@/lib/instagram-client/target-ai-route-auth";
import { serializeTargetAiCandidateForClient } from "@/lib/instagram-client/target-ai-candidate-avatar";
import { verifyTargetAiSessionUsernames } from "@/lib/instagram-client/target-ai-search-v2-service";

export const dynamic = "force-dynamic";

type VerifyBody = {
  session_id?: string;
  usernames?: string[];
  niche?: string;
  location?: { label?: string } | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeClientTargetAiRoute(accountId ?? "", { requireAiConfig: true });
  if ("error" in auth) return auth.error;

  let body: VerifyBody | null = null;
  try {
    body = await request.json() as VerifyBody;
  } catch {
    return jsonTargetAiError("invalid_niche", 400);
  }

  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) {
    return NextResponse.json({ ok: false, error: technicalError, error_code: "invalid_niche" }, { status: 400 });
  }

  const sessionId = readString(body?.session_id, "").trim();
  const usernames = Array.isArray(body?.usernames)
    ? body.usernames.map((entry) => readString(entry, "").trim().replace(/^@+/, "").toLowerCase()).filter(Boolean)
    : [];

  if (!sessionId || usernames.length === 0) {
    return jsonTargetAiError("invalid_niche", 400);
  }

  const verified = await verifyTargetAiSessionUsernames({
    sessionId,
    usernames,
    niche: readString(body?.niche, "").trim() || undefined,
    locationLabel: readString(body?.location?.label, "").trim() || null,
  });

  if (!verified) {
    return jsonTargetAiError("target_ai_provider_error", 404);
  }

  const normalizedAccountId = accountId?.trim() ?? "";
  const candidates = verified.candidates.map((candidate) => serializeTargetAiCandidateForClient(normalizedAccountId, candidate));

  return NextResponse.json({
    ok: true,
    data: {
      session_id: sessionId,
      candidates,
      verification_summary: verified.verificationSummary,
    },
  });
}
