import { NextResponse } from "next/server";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  requireRelayOrAdmin,
} from "../../_utils";
import {
  loadTargetingAiConfigSnapshot,
  saveTargetingAiConfig,
  serializeTargetingAiPublicConfig,
} from "@/lib/instagram-client/targeting-ai-config-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Targeting AI config");
  if (unauthorizedResponse) return unauthorizedResponse;

  const snapshot = await loadTargetingAiConfigSnapshot();
  return jsonOk({
    ...serializeTargetingAiPublicConfig(snapshot),
    editable: snapshot.editable,
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
  });
}

export async function PATCH(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Targeting AI config");
  if (unauthorizedResponse) return unauthorizedResponse;

  const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
  const userContext = await getInstagramAdminUserContext();
  const updatedBy = request.headers.get("x-external-user-id")?.trim()
    || userContext?.userId
    || "botapp_relay";

  const result = await saveTargetingAiConfig({ patch: body, updatedBy });
  if (!result.ok) {
    return jsonError(result.reason, result.backend_pending ? 503 : 400, {
      field: result.field ?? null,
      backend_pending: result.backend_pending ?? false,
    });
  }

  return jsonOk({
    ...serializeTargetingAiPublicConfig(result.snapshot),
    saved_at: result.saved_at,
    log_event: "targeting_ai_config_saved",
  });
}

export async function POST(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Targeting AI config");
  if (unauthorizedResponse) return unauthorizedResponse;

  const url = new URL(request.url);
  if (url.searchParams.get("action") !== "save") {
    return jsonError("Unsupported action.", 400);
  }

  const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
  const userContext = await getInstagramAdminUserContext();
  const updatedBy = request.headers.get("x-external-user-id")?.trim()
    || userContext?.userId
    || "botapp_relay";

  const result = await saveTargetingAiConfig({ patch: body, updatedBy });
  if (!result.ok) {
    return jsonError(result.reason, result.backend_pending ? 503 : 400, {
      field: result.field ?? null,
      backend_pending: result.backend_pending ?? false,
    });
  }

  return jsonOk({
    ...serializeTargetingAiPublicConfig(result.snapshot),
    saved_at: result.saved_at,
    log_event: "targeting_ai_config_saved",
  });
}
