import { NextResponse } from "next/server";

type VoiceTestLiveRequest = {
  caller_phone?: unknown;
  language?: unknown;
};

type JsonRecord = Record<string, unknown>;
type VapiDebug = {
  apiBaseUrl: string;
  hasApiKey: boolean;
  assistantId: string;
  phoneNumberId: string;
  requestPayload?: unknown;
  vapiRequestPayload?: unknown;
  vapiResponse?: {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
};

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

function maskSecret(value: string | undefined) {
  if (!value) return "";
  if (value.length <= 8) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    stack: null,
  };
}

async function parseVapiResponse(response: Response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function responseHeadersToRecord(headers: Headers) {
  return Object.fromEntries(headers.entries());
}

export async function POST(request: Request) {
  const apiKey = process.env.RESTAURANT_VAPI_API_KEY;
  const assistantId = process.env.RESTAURANT_VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.RESTAURANT_VAPI_PHONE_NUMBER_ID;
  const apiBaseUrl = "https://api.vapi.ai";
  const debug: VapiDebug = {
    apiBaseUrl,
    hasApiKey: Boolean(apiKey),
    assistantId: assistantId || "",
    phoneNumberId: phoneNumberId || "",
  };

  console.log("[voice-test:start-live] environment", {
    RESTAURANT_VAPI_API_KEY: maskSecret(apiKey),
    RESTAURANT_VAPI_ASSISTANT_ID: assistantId || "",
    RESTAURANT_VAPI_PHONE_NUMBER_ID: phoneNumberId || "",
    VAPI_CALL_URL: `${apiBaseUrl}/call`,
  });

  let body: VoiceTestLiveRequest;

  try {
    body = (await request.json()) as VoiceTestLiveRequest;
    debug.requestPayload = body;
    console.log("[voice-test:start-live] incoming request payload", body);
  } catch (error) {
    const formattedError = formatError(error);
    console.error("[voice-test:start-live] failed to parse request JSON", formattedError);
    console.error("[voice-test:start-live] failed to parse request JSON stack", formattedError.stack || formattedError.message);

    return NextResponse.json(
      {
        success: false,
        mode: "live",
        provider: "vapi",
        error: "Invalid JSON request body",
        message: "Invalid JSON request body",
        callId: null,
        status: "invalid_request",
        summary: null,
        debug,
      },
      { status: 400 }
    );
  }

  try {
    const callerPhone = typeof body.caller_phone === "string" ? body.caller_phone.trim() : "";

    if (!callerPhone) {
      console.log("[voice-test:start-live] missing required phone number", { body });

      return NextResponse.json(
        {
          success: false,
          mode: "live",
          provider: "vapi",
          error: "Phone number is required",
          message: "A phone number is required.",
          callId: null,
          status: "missing_phone",
          summary: null,
          debug,
        },
        { status: 400 }
      );
    }

    if (!apiKey || !assistantId || !phoneNumberId) {
      console.log("[voice-test:start-live] missing VAPI configuration", {
        hasApiKey: Boolean(apiKey),
        hasAssistantId: Boolean(assistantId),
        hasPhoneNumberId: Boolean(phoneNumberId),
      });

      return NextResponse.json(
        {
          success: false,
          mode: "live",
          provider: "vapi",
          error: "Missing VAPI configuration",
          message: "Missing VAPI configuration",
          callId: null,
          status: "not_connected",
          summary: null,
          debug,
        },
        { status: 500 }
      );
    }

    const vapiRequestPayload = {
      assistantId,
      phoneNumberId,
      customer: {
        number: callerPhone,
      },
    };
    debug.vapiRequestPayload = vapiRequestPayload;

    console.log("[voice-test:start-live] Vapi request payload", vapiRequestPayload);

    const vapiResponse = await fetch(`${apiBaseUrl}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vapiRequestPayload),
      cache: "no-store",
    });

    const raw = await parseVapiResponse(vapiResponse);
    const vapiResponseDebug = {
      ok: vapiResponse.ok,
      status: vapiResponse.status,
      statusText: vapiResponse.statusText,
      headers: responseHeadersToRecord(vapiResponse.headers),
      body: raw,
    };
    debug.vapiResponse = vapiResponseDebug;

    console.log("[voice-test:start-live] Vapi response", vapiResponseDebug);

    if (!vapiResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          mode: "live",
          provider: "vapi",
          error: readString(raw, ["message", "error"], "Vapi call failed"),
          message: "The live voice call could not be started.",
          callId: null,
          status: "failed",
          summary: null,
          debug,
        },
        { status: 502 }
      );
    }

    const callId = readString(raw, ["id", "callId"]);

    return NextResponse.json({
      success: Boolean(callId),
      mode: "live",
      provider: "vapi",
      ...(callId ? {} : { error: "Vapi did not return a call id" }),
      message: callId ? "Live voice call started." : "The live voice call could not be started.",
      callId: callId || null,
      status: readString(raw, ["status"], callId ? "started" : "failed"),
      summary: null,
      debug,
    });
  } catch (error) {
    const formattedError = formatError(error);
    console.error("[voice-test:start-live] unhandled error", formattedError);
    console.error("[voice-test:start-live] unhandled error stack", formattedError.stack || formattedError.message);

    return NextResponse.json(
      {
        success: false,
        mode: "live",
        provider: "vapi",
        error: formattedError.message,
        message: "The live voice call could not be started.",
        callId: null,
        status: "failed",
        summary: null,
        debug: {
          ...debug,
          error: formattedError,
        },
      },
      { status: 500 }
    );
  }
}
