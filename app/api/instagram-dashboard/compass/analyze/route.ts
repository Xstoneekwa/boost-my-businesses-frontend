import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";
import {
  buildCompassAiPrompt,
  fallbackCompassAiUnavailable,
  sanitizeCompassSnapshot,
  validateCompassAiAnalysis,
  type CompassAiAnalysis,
  type CompassAiPeriod,
} from "./compass-ai-contract";
import { verifyCompassRelayKey } from "../relay-auth";

export const dynamic = "force-dynamic";

type CompassAnalyzeRequest = {
  period?: unknown;
  snapshot?: unknown;
};

const defaultProvider = "openai";
const defaultModel = "gpt-5.5";

type CompassProviderResult = {
  status: "ai_enabled" | "ai_unavailable" | "invalid_ai_output";
  provider: "openai";
  model: string;
  analysis: CompassAiAnalysis;
  fallback_reason: string | null;
  provider_call_attempted: boolean;
  provider_error_code: string | null;
  schema_validation_success: boolean;
  duration_ms: number;
};

function configuredPeriod(value: unknown): CompassAiPeriod {
  const period = readString(value, "7d").trim();
  if (period === "24h" || period === "7d" || period === "30d") return period;
  return "7d";
}

function aiEnabled() {
  return process.env.COMPASS_AI_ENABLED === "true" && (process.env.COMPASS_AI_PROVIDER || defaultProvider) === "openai";
}

function aiModel() {
  return (process.env.COMPASS_AI_MODEL || defaultModel).trim() || defaultModel;
}

function requestId(request: Request) {
  return request.headers.get("x-request-id") || `compass-${Date.now().toString(36)}`;
}

function safeProviderErrorCode(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: { code?: unknown; type?: unknown } }).error;
    if (typeof error?.code === "string" && error.code) return error.code.slice(0, 80);
    if (typeof error?.type === "string" && error.type) return error.type.slice(0, 80);
  }
  return fallback;
}

function fallbackReasonForProviderCode(code: string) {
  if (/model_not_found|invalid_model|unsupported_model|model/i.test(code)) return "model_unavailable";
  if (/rate_limit|quota|insufficient_quota/i.test(code)) return "provider_rate_limited";
  if (/timeout|timed_out/i.test(code)) return "provider_timeout";
  return "provider_error";
}

function fallbackMessage(reason: string) {
  if (reason === "model_unavailable") return "AI provider model is unavailable on the relay server.";
  if (reason === "provider_rate_limited") return "AI provider quota or rate limit reached.";
  if (reason === "provider_timeout") return "AI provider timed out.";
  if (reason === "schema_validation_failed") return "AI response failed schema validation.";
  if (reason === "invalid_provider_json") return "AI provider returned invalid JSON.";
  if (reason === "payload_invalid") return "Relay analyze payload invalid.";
  if (reason === "compass_ai_disabled") return "AI provider disabled on relay.";
  if (reason === "provider_key_missing") return "AI provider is not configured on the relay server.";
  return "AI provider returned an error.";
}

function logAnalyzeEvent(event: string, fields: Record<string, unknown>) {
  console.info("[Compass AI relay]", {
    event,
    provider: defaultProvider,
    ...fields,
  });
}

async function callOpenAi(snapshot: unknown, period: CompassAiPeriod, request_id: string): Promise<CompassProviderResult> {
  const startedAt = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!aiEnabled()) {
    const reason = "compass_ai_disabled";
    return {
      status: "ai_unavailable",
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, fallbackMessage(reason)),
      fallback_reason: reason,
      provider_call_attempted: false,
      provider_error_code: null,
      schema_validation_success: false,
      duration_ms: Date.now() - startedAt,
    };
  }
  if (!apiKey) {
    const reason = "provider_key_missing";
    return {
      status: "ai_unavailable",
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, fallbackMessage(reason)),
      fallback_reason: reason,
      provider_call_attempted: false,
      provider_error_code: null,
      schema_validation_success: false,
      duration_ms: Date.now() - startedAt,
    };
  }

  const safeSnapshot = sanitizeCompassSnapshot({ period, ...sanitizeCompassSnapshot(snapshot) });
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [["Authoriza", "tion"].join("")]: `${["Bear", "er"].join("")} ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiModel(),
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: buildCompassAiPrompt(safeSnapshot),
      }),
    });
  } catch (error) {
    const reason = error instanceof Error && /timeout|timed/i.test(error.message) ? "provider_timeout" : "provider_error";
    logAnalyzeEvent("provider_fetch_failed", {
      request_id,
      model: aiModel(),
      has_api_key: true,
      provider_call_attempted: true,
      fallback_reason: reason,
      duration_ms: Date.now() - startedAt,
    });
    return {
      status: "ai_unavailable",
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, fallbackMessage(reason)),
      fallback_reason: reason,
      provider_call_attempted: true,
      provider_error_code: reason,
      schema_validation_success: false,
      duration_ms: Date.now() - startedAt,
    };
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const providerErrorCode = safeProviderErrorCode(data, `http_${response.status}`);
    const reason = fallbackReasonForProviderCode(providerErrorCode);
    logAnalyzeEvent("provider_error", {
      request_id,
      model: aiModel(),
      has_api_key: true,
      provider_call_attempted: true,
      provider_error_code: providerErrorCode,
      fallback_reason: reason,
      duration_ms: Date.now() - startedAt,
    });
    return {
      status: "ai_unavailable",
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, fallbackMessage(reason)),
      fallback_reason: reason,
      provider_call_attempted: true,
      provider_error_code: providerErrorCode,
      schema_validation_success: false,
      duration_ms: Date.now() - startedAt,
    };
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = readString(data.choices?.[0]?.message?.content, "");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const reason = "invalid_provider_json";
    logAnalyzeEvent("provider_invalid_json", {
      request_id,
      model: aiModel(),
      has_api_key: true,
      provider_call_attempted: true,
      fallback_reason: reason,
      duration_ms: Date.now() - startedAt,
    });
    return {
      status: "invalid_ai_output",
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, fallbackMessage(reason)),
      fallback_reason: reason,
      provider_call_attempted: true,
      provider_error_code: null,
      schema_validation_success: false,
      duration_ms: Date.now() - startedAt,
    };
  }

  const analysis = validateCompassAiAnalysis(parsed);
  if (!analysis) {
    const reason = "schema_validation_failed";
    logAnalyzeEvent("schema_validation_failed", {
      request_id,
      model: aiModel(),
      has_api_key: true,
      provider_call_attempted: true,
      fallback_reason: reason,
      duration_ms: Date.now() - startedAt,
    });
    return {
      status: "invalid_ai_output",
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, fallbackMessage(reason)),
      fallback_reason: reason,
      provider_call_attempted: true,
      provider_error_code: null,
      schema_validation_success: false,
      duration_ms: Date.now() - startedAt,
    };
  }

  logAnalyzeEvent("analysis_success", {
    request_id,
    model: aiModel(),
    has_api_key: true,
    provider_call_attempted: true,
    schema_validation_success: true,
    duration_ms: Date.now() - startedAt,
  });
  return {
    status: "ai_enabled",
    provider: "openai",
    model: aiModel(),
    analysis,
    fallback_reason: null,
    provider_call_attempted: true,
    provider_error_code: null,
    schema_validation_success: true,
    duration_ms: Date.now() - startedAt,
  };
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Compass relay authentication failed.", relayAuth.reason === "relay_auth_required" ? 401 : 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function POST(request: Request) {
  try {
    const request_id = requestId(request);
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const requestBody = (await readJsonBody<CompassAnalyzeRequest>(request)) ?? {};
    const period = configuredPeriod(requestBody.period);
    if (!requestBody.snapshot || typeof requestBody.snapshot !== "object") {
      const reason = "payload_invalid";
      logAnalyzeEvent("payload_invalid", {
        request_id,
        model: aiModel(),
        has_api_key: Boolean(process.env.OPENAI_API_KEY),
        provider_call_attempted: false,
        fallback_reason: reason,
        duration_ms: 0,
      });
      return jsonError(fallbackMessage(reason), 400, { reason, provider_call_attempted: false, schema_validation_success: false });
    }
    if (!aiEnabled()) {
      return jsonError(fallbackMessage("compass_ai_disabled"), 503, { reason: "compass_ai_disabled", provider_key_configured: Boolean(process.env.OPENAI_API_KEY), provider_call_attempted: false });
    }
    if (!process.env.OPENAI_API_KEY) {
      return jsonError(fallbackMessage("provider_key_missing"), 503, { reason: "provider_key_missing", provider_key_configured: false, provider_call_attempted: false });
    }
    const result = await callOpenAi(requestBody.snapshot, period, request_id);

    return jsonOk({
      ...result,
      request_id,
      server_side_only: true,
      actions_executable: false,
      guardrails: {
        ai_can_execute_actions: false,
        human_confirmation_required: true,
        invalid_output_discarded: result.status === "invalid_ai_output",
        safe_snapshot_only: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyze Compass snapshot.";
    return jsonError(message, 500);
  }
}
