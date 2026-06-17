import { NextResponse } from "next/server";
import { requireInstagramAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";
import { buildTargetAiPromptPreview } from "@/lib/instagram-client/target-ai-contract";
import { buildTargetingAiPublicConfig } from "@/lib/instagram-client/targeting-ai-settings";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return NextResponse.json({ ok: false, reason: relayAuth.reason }, { status: relayAuth.reason === "relay_auth_required" ? 401 : 403 });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;

  const prompt = buildTargetAiPromptPreview();
  const config = buildTargetingAiPublicConfig();

  return NextResponse.json({
    ok: true,
    data: {
      ...config,
      roles: {
        gpt: [
          "Understand niche and optional location",
          "Generate search strategy and multiple angles",
          "Propose seed usernames, keywords, and hashtag hints for verification",
          "Broaden search on second pass when results are too weak",
        ],
        searchapi: [
          "Verify account existence",
          "Fetch avatar, followers, verified, and private flags",
          "Normalize username",
          "Provide final eligibility inputs",
        ],
      },
      prompt: {
        version: prompt.version,
        system_preview: prompt.system,
        user_template_preview: prompt.user_template,
        editable: false,
        storage: "code_versioned",
      },
    },
  });
}
