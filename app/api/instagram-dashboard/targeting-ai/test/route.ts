import {
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
} from "../../_utils";
import { resolveActiveTargetingAiConfig } from "@/lib/instagram-client/targeting-ai-config-store";
import { callTargetAiOpenAiDiscovery } from "@/lib/instagram-client/targeting-ai-openai";

export const dynamic = "force-dynamic";

type TestBody = {
  niche?: string;
  location_label?: string | null;
  dry_run?: boolean;
};

export async function POST(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Targeting AI test");
  if (unauthorizedResponse) return unauthorizedResponse;

  const body = (await readJsonBody<TestBody>(request)) ?? {};
  const niche = readString(body.niche, "coffee shop").trim() || "coffee shop";
  const locationLabel = readString(body.location_label, "Paris, France").trim() || null;
  const config = await resolveActiveTargetingAiConfig({ bypassCache: true });

  const startedAt = Date.now();
  const result = await callTargetAiOpenAiDiscovery({
    config,
    niche,
    locationLabel,
    pass: "primary",
  });

  return jsonOk({
    dry_run: body.dry_run !== false,
    niche,
    location_label: locationLabel,
    prompt_version: result.prompt_version,
    prompt_source: result.prompt_source,
    model: result.model,
    provider: result.provider,
    gpt_candidates_count: result.usernames.length,
    error_code: result.error_code,
    latency_ms: Date.now() - startedAt,
    log_event: "targeting_ai_config_test",
  });
}
