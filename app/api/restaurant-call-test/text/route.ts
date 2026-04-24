import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TextTestRequest = {
  message?: unknown;
  caller_phone?: unknown;
  language?: unknown;
};

type JsonRecord = Record<string, unknown>;

const TOOL_NAME = "restaurant_router_tool";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: unknown, keys: string[], fallback = "") {
  if (!isRecord(source)) return fallback;

  for (const key of keys) {
    const value = source[key];

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
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

function pickLikelyPayload(response: unknown): unknown {
  if (Array.isArray(response)) return response[0] ?? {};
  if (!isRecord(response)) return response;

  const nestedCandidates = [
    response.data,
    response.result,
    response.output,
    response.response,
    response.body,
    response.json,
  ];

  for (const candidate of nestedCandidates) {
    if (isRecord(candidate)) return candidate;
    if (Array.isArray(candidate)) return candidate[0] ?? {};
  }

  return response;
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

function normalizeRouterResponse(raw: unknown, fallbackIntent: string) {
  const payload = pickLikelyPayload(raw);
  const intent = readString(payload, ["intent", "detected_intent", "detectedIntent", "classification"], fallbackIntent);
  const escalated = readBoolean(payload, ["escalated", "requires_escalation", "requiresEscalation", "human_handoff", "handoff"], false);
  const routerKey = readString(payload, ["router_key", "routerKey", "route", "route_key", "routing_key"], intent || "restaurant_general");

  return {
    intent,
    router_key: routerKey,
    route_selected: routerKey,
    agent_called: readString(payload, ["agent_called", "agentCalled", "agent", "called_agent", "next_agent"], "Restaurant Assistant"),
    escalated,
    handoff_required: escalated,
    outcome: readString(payload, ["outcome", "status", "result", "resolution", "action"], escalated ? "Escalated to the restaurant team" : "Handled by the assistant"),
    final_response: readString(
      payload,
      ["final_response", "finalResponse", "response_text", "message", "reply", "answer", "text", "output"],
      escalated
        ? "Thanks. I will pass this request to the restaurant team with the right context."
        : "Thanks. I can help with that and confirm the next step."
    ),
    raw,
  };
}

async function parseBackendResponse(response: Response) {
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
  const endpointUrl = process.env.RESTAURANT_CALL_TEXT_TEST_ENDPOINT_URL || process.env.RESTAURANT_CALL_TEST_WEBHOOK_URL;

  console.log("[restaurant-call-test:text] environment", {
    hasRestaurantCallTextTestEndpointUrl: Boolean(process.env.RESTAURANT_CALL_TEXT_TEST_ENDPOINT_URL),
    hasRestaurantCallTestWebhookUrl: Boolean(process.env.RESTAURANT_CALL_TEST_WEBHOOK_URL),
    endpointUrl: endpointUrl || null,
  });

  if (!endpointUrl) {
    return NextResponse.json(
      {
        success: false,
        error: "text_test_not_configured",
      },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json()) as TextTestRequest;
    console.log("[restaurant-call-test:text] received body", body);

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const callerPhone = typeof body.caller_phone === "string" ? body.caller_phone.trim() : "";
    const language = typeof body.language === "string" && body.language.trim() ? body.language.trim() : "en";

    if (!message) {
      return NextResponse.json(
        {
          success: false,
          error: "message_required",
        },
        { status: 400 }
      );
    }

    const intent = inferIntent(message);
    const backendPayload = {
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
        id: `text_test_${Date.now()}`,
      },
      source: "restaurant_call_text_test",
    };

    console.log("[restaurant-call-test:text] backend request", {
      endpointUrl,
      body: backendPayload,
    });

    const backendResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(backendPayload),
      cache: "no-store",
    });

    const raw = await parseBackendResponse(backendResponse);
    console.log("[restaurant-call-test:text] backend response", {
      ok: backendResponse.ok,
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      body: raw,
    });

    if (!backendResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "text_test_failed",
          message: readString(raw, ["message", "error", "details"], "The test service returned an error."),
          debug: {
            status: backendResponse.status,
            statusText: backendResponse.statusText,
            body: raw,
          },
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: normalizeRouterResponse(raw, intent),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[restaurant-call-test:text] unhandled error", error);

    return NextResponse.json(
      {
        success: false,
        error: "text_test_failed",
        message: error instanceof Error ? error.message : "The test service returned an error.",
      },
      { status: 500 }
    );
  }
}
