import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RestaurantCallTestRequest = {
  message?: unknown;
  caller_phone?: unknown;
  language?: unknown;
};

type NormalizedRestaurantCallResult = {
  intent: string;
  router_key: string;
  agent_called: string;
  escalated: boolean;
  outcome: string;
  final_response: string;
  raw: unknown;
};

type JsonRecord = Record<string, unknown>;

const SOURCE = "restaurant_call_test_page";
const TOOL_NAME = "restaurant_router_tool";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: unknown, keys: string[], fallback = "") {
  if (!isRecord(source)) return fallback;

  for (const key of keys) {
    const value = source[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }

  return fallback;
}

function readBoolean(source: unknown, keys: string[], fallback = false) {
  if (!isRecord(source)) return fallback;

  for (const key of keys) {
    const value = source[key];

    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "escalated"].includes(normalized)) return true;
      if (["false", "no", "0", "handled", "auto_handled"].includes(normalized)) return false;
    }
  }

  return fallback;
}

function pickLikelyPayload(webhookResponse: unknown): unknown {
  if (Array.isArray(webhookResponse)) {
    return webhookResponse[0] ?? {};
  }

  if (!isRecord(webhookResponse)) {
    return webhookResponse;
  }

  const nestedCandidates = [
    webhookResponse.data,
    webhookResponse.result,
    webhookResponse.output,
    webhookResponse.response,
    webhookResponse.body,
    webhookResponse.json,
  ];

  for (const candidate of nestedCandidates) {
    if (isRecord(candidate)) return candidate;
    if (Array.isArray(candidate)) return candidate[0] ?? {};
  }

  return webhookResponse;
}

function normalizeWebhookResponse(raw: unknown, fallbackIntent: string): NormalizedRestaurantCallResult {
  const payload = pickLikelyPayload(raw);

  const intent = readString(payload, ["intent", "detected_intent", "detectedIntent", "classification"], fallbackIntent);
  const routerKey = readString(payload, ["router_key", "routerKey", "route", "route_key", "routing_key"], intent || "restaurant_general");
  const agentCalled = readString(payload, ["agent_called", "agentCalled", "agent", "called_agent", "next_agent"], "Restaurant Router Agent");
  const escalated = readBoolean(payload, ["escalated", "requires_escalation", "requiresEscalation", "human_handoff", "handoff"], false);
  const outcome = readString(
    payload,
    ["outcome", "status", "result", "resolution", "action"],
    escalated ? "Escalated to human team" : "Handled by AI"
  );
  const finalResponse = readString(
    payload,
    ["final_response", "finalResponse", "response_text", "message", "reply", "answer", "text"],
    escalated
      ? "Thanks. I am going to pass this to the restaurant team with the details from your call."
      : "Thanks. I can help with that request and confirm the next step for the restaurant."
  );

  return {
    intent,
    router_key: routerKey,
    agent_called: agentCalled,
    escalated,
    outcome,
    final_response: finalResponse,
    raw,
  };
}

function inferIntent(message: string) {
  const normalized = message.toLowerCase();

  if (/\b(complain|complaint|manager|urgent|emergency|angry|unhappy|plainte|responsable|urgence)\b/.test(normalized)) {
    return "escalation";
  }

  if (/\b(modify|cancel|change|reschedule|update|move|annuler|modifier|changer|déplacer)\b/.test(normalized)) {
    return "crm";
  }

  if (/\b(book|booking|reserve|reservation|table|réserver|réservation)\b/.test(normalized)) {
    return "booking";
  }

  if (/\b(menu|vegan|gluten|opening|hours|open|allergy|allergies|vegetarian|halal|parking|address|horaires|adresse|allergie)\b/.test(normalized)) {
    return "rag";
  }

  return "general";
}

function createTestCallId() {
  return `test_call_${Date.now()}`;
}

async function parseWebhookJson(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json() as Promise<unknown>;
  }

  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { final_response: text };
  }
}

export async function POST(request: Request) {
  try {
    const webhookUrl = process.env.RESTAURANT_CALL_TEST_WEBHOOK_URL;

    if (!webhookUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "RESTAURANT_CALL_TEST_WEBHOOK_URL is not configured.",
        },
        { status: 500 }
      );
    }

    const body = (await request.json()) as RestaurantCallTestRequest;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const callerPhone = typeof body.caller_phone === "string" ? body.caller_phone.trim() : "";
    const language = typeof body.language === "string" && body.language.trim() ? body.language.trim() : "en";
    const intent = inferIntent(message);

    if (!message) {
      return NextResponse.json(
        {
          success: false,
          error: "message is required.",
        },
        { status: 400 }
      );
    }

    const webhookPayload = {
      message: {
        toolCalls: [
          {
            function: {
              name: TOOL_NAME,
              arguments: {
                intent,
                question: message,
                language,
              },
            },
          },
        ],
      },
      customer: {
        number: callerPhone,
      },
      call: {
        id: createTestCallId(),
      },
      source: SOURCE,
    };

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(webhookPayload),
      cache: "no-store",
    });

    const raw = await parseWebhookJson(webhookResponse);

    if (!webhookResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "Restaurant call webhook returned an error.",
          details: isRecord(raw) ? readString(raw, ["error", "message", "details"], webhookResponse.statusText) : webhookResponse.statusText,
        },
        { status: webhookResponse.status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: normalizeWebhookResponse(raw, intent),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Restaurant call test route failed.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/*
Required .env.local variable:
RESTAURANT_CALL_TEST_WEBHOOK_URL=https://your-n8n-domain/webhook/restaurant-call-test
*/
