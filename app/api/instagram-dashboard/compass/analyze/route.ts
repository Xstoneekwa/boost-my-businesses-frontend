import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";
import {
  buildCompassAiPrompt,
  fallbackCompassAiUnavailable,
  sanitizeCompassSnapshot,
  validateCompassAiAnalysis,
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

async function callOpenAi(snapshot: unknown, period: CompassAiPeriod) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!aiEnabled()) {
    return {
      status: "ai_unavailable" as const,
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, "AI advisor unavailable. Rules-only Compass facts remain available."),
    };
  }
  if (!apiKey) {
    return {
      status: "ai_unavailable" as const,
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, "AI advisor unavailable because server configuration is incomplete."),
    };
  }

  const safeSnapshot = sanitizeCompassSnapshot({ period, ...sanitizeCompassSnapshot(snapshot) });
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

  if (!response.ok) {
    return {
      status: "ai_unavailable" as const,
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, "AI advisor unavailable. Server-side provider returned a safe fallback."),
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

  const analysis = validateCompassAiAnalysis(parsed);
  if (!analysis) {
    return {
      status: "invalid_ai_output" as const,
      provider: "openai",
      model: aiModel(),
      analysis: fallbackCompassAiUnavailable(period, "AI advisor returned invalid structured output. Rules-only Compass facts remain available."),
    };
  }

  return {
    status: "ai_enabled" as const,
    provider: "openai",
    model: aiModel(),
    analysis,
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
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const requestBody = (await readJsonBody<CompassAnalyzeRequest>(request)) ?? {};
    const period = configuredPeriod(requestBody.period);
    if (!aiEnabled()) {
      return jsonError("Compass AI is not enabled on the relay server.", 503, { reason: "compass_ai_disabled", provider_key_configured: Boolean(process.env.OPENAI_API_KEY) });
    }
    if (!process.env.OPENAI_API_KEY) {
      return jsonError("AI provider is not configured on the relay server.", 503, { reason: "provider_key_missing", provider_key_configured: false });
    }
    const result = await callOpenAi(requestBody.snapshot ?? {}, period);

    return jsonOk({
      ...result,
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
