export type TargetAiErrorCode =
  | "plan_not_allowed"
  | "target_ai_disabled"
  | "target_ai_provider_missing"
  | "target_ai_provider_error"
  | "ownership_denied"
  | "invalid_niche"
  | "no_candidates_found"
  | "location_unavailable";

export function isTargetAiConfigured() {
  return process.env.TARGET_AI_ENABLED === "true" && Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function readTargetAiConfigStatus(): "ready" | "target_ai_disabled" | "target_ai_provider_missing" {
  if (process.env.TARGET_AI_ENABLED !== "true") return "target_ai_disabled";
  if (!process.env.OPENAI_API_KEY?.trim()) return "target_ai_provider_missing";
  return "ready";
}

export function safeTargetAiLog(event: string, fields: Record<string, unknown>) {
  console.info("[Target AI]", { event, ...fields });
}
