import { NextResponse } from "next/server";

type JsonRecord = Record<string, unknown>;
type VoiceRuntimeStatus = "calling" | "in_progress" | "completed" | "failed";

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

function readNestedString(source: unknown, path: string[], fallback = "") {
  let current = source;

  for (const key of path) {
    if (!isRecord(current)) return fallback;
    current = current[key];
  }

  return typeof current === "string" && current.trim() ? current.trim() : fallback;
}

function normalizeVapiStatus(status: string, endedReason: string) {
  const normalizedStatus = status.trim().toLowerCase().replace(/_/g, "-");
  const normalizedEndedReason = endedReason.trim().toLowerCase();

  if (["scheduled", "queued", "ringing"].includes(normalizedStatus)) {
    return { status: "calling" satisfies VoiceRuntimeStatus, terminal: false };
  }

  if (["in-progress", "forwarding"].includes(normalizedStatus)) {
    return { status: "in_progress" satisfies VoiceRuntimeStatus, terminal: false };
  }

  if (["failed", "error", "canceled", "cancelled"].includes(normalizedStatus)) {
    return { status: "failed" satisfies VoiceRuntimeStatus, terminal: true };
  }

  if (["ended", "completed", "complete"].includes(normalizedStatus)) {
    const failedEnd =
      normalizedEndedReason.includes("error") ||
      normalizedEndedReason.includes("failed") ||
      normalizedEndedReason.includes("failure");

    return { status: failedEnd ? ("failed" satisfies VoiceRuntimeStatus) : ("completed" satisfies VoiceRuntimeStatus), terminal: true };
  }

  return { status: "in_progress" satisfies VoiceRuntimeStatus, terminal: false };
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

export async function GET(request: Request) {
  const apiKey = process.env.RESTAURANT_VAPI_API_KEY;
  const apiBaseUrl = "https://api.vapi.ai";
  const { searchParams } = new URL(request.url);
  const callId = searchParams.get("callId")?.trim() || "";

  if (!callId) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing call id",
        message: "Missing call id",
        callId: null,
        status: "failed",
        rawStatus: "",
        endedReason: "",
        terminal: true,
        summary: null,
      },
      { status: 400 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing VAPI configuration",
        message: "Missing VAPI configuration",
        callId,
        status: "failed",
        rawStatus: "",
        endedReason: "",
        terminal: true,
        summary: null,
      },
      { status: 500 }
    );
  }

  try {
    const vapiResponse = await fetch(`${apiBaseUrl}/call/${encodeURIComponent(callId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const raw = await parseVapiResponse(vapiResponse);

    if (!vapiResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: readString(raw, ["message", "error"], "Vapi call status could not be loaded"),
          message: "Vapi call status could not be loaded",
          callId,
          status: "failed",
          rawStatus: "",
          endedReason: "",
          terminal: true,
          summary: null,
          debug: {
            vapiStatus: vapiResponse.status,
            vapiStatusText: vapiResponse.statusText,
            vapiResponse: raw,
          },
        },
        { status: 502 }
      );
    }

    const rawStatus = readString(raw, ["status"], "in-progress");
    const endedReason = readString(raw, ["endedReason"], "");
    const normalized = normalizeVapiStatus(rawStatus, endedReason);
    const summary =
      readString(raw, ["summary", "endedMessage"]) ||
      readNestedString(raw, ["analysis", "summary"]) ||
      readNestedString(raw, ["artifact", "transcript"]);

    return NextResponse.json({
      success: true,
      mode: "live",
      provider: "vapi",
      callId: readString(raw, ["id"], callId),
      status: normalized.status,
      rawStatus,
      endedReason,
      terminal: normalized.terminal,
      summary,
      message: normalized.terminal ? "Live voice call ended." : "Live voice call is active.",
    });
  } catch (error) {
    const formattedError = formatError(error);
    console.error("[voice-test:status-live] unhandled error", formattedError);
    console.error("[voice-test:status-live] unhandled error stack", formattedError.stack || formattedError.message);

    return NextResponse.json(
      {
        success: false,
        error: formattedError.message,
        message: "Vapi call status could not be loaded",
        callId,
        status: "failed",
        rawStatus: "",
        endedReason: "",
        terminal: true,
        summary: null,
        debug: {
          error: formattedError,
        },
      },
      { status: 500 }
    );
  }
}
