import { restaurantCallTestConfig } from "@/lib/restaurant-call-test/config";

export type VoiceTestRuntimeStatus = "idle" | "calling" | "in_progress" | "completed" | "failed";

type VoiceTestStartResult = {
  success: boolean;
  mode: "mock" | "live";
  provider: "vapi" | "none";
  callId: string | null;
  status: string;
  summary: string;
  message: string;
  end?: () => Promise<void>;
};

type VoiceTestStatusResult = {
  success: boolean;
  mode: "live";
  provider: "vapi";
  callId: string | null;
  status: VoiceTestRuntimeStatus;
  rawStatus: string;
  endedReason: string;
  terminal: boolean;
  summary: string;
  message: string;
};

type VoiceTestStartOptions = {
  callerPhone?: string;
  language?: "fr" | "en";
  onStatusChange?: (status: VoiceTestRuntimeStatus) => void;
  onCallId?: (callId: string) => void;
  onSummary?: (summary: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: unknown, key: string, fallback = "") {
  if (!isRecord(source)) return fallback;
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readBoolean(source: unknown, key: string, fallback = false) {
  if (!isRecord(source)) return fallback;
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

export async function startVoiceTest(options: VoiceTestStartOptions = {}): Promise<VoiceTestStartResult> {
  const endpoint = restaurantCallTestConfig.voiceTestMode === "live" ? "/api/voice-test/start-live" : "/api/voice-test/start";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: restaurantCallTestConfig.voiceTestMode,
      provider: restaurantCallTestConfig.voiceTestProvider,
      caller_phone: options.callerPhone,
      language: options.language,
    }),
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(readString(payload, "message", "voice_test_failed"));
  }

  if (restaurantCallTestConfig.voiceTestMode === "live") {
    if (!readBoolean(payload, "success", false)) {
      return {
        success: false,
        mode: "live",
        provider: "vapi",
        callId: null,
        status: readString(payload, "status", "not_connected"),
        summary: readString(payload, "summary"),
        message: readString(payload, "message", "live_voice_unavailable"),
      };
    }

    const result: VoiceTestStartResult = {
      success: true,
      mode: "live",
      provider: "vapi",
      callId: readString(payload, "callId") || null,
      status: readString(payload, "status", "started"),
      summary: readString(payload, "summary"),
      message: readString(payload, "message"),
    };

    if (!result.callId) {
      throw new Error("voice_test_failed");
    }

    options.onCallId?.(result.callId);
    options.onStatusChange?.("in_progress");

    return result;
  }

  const result: VoiceTestStartResult = {
    success: readBoolean(payload, "success", restaurantCallTestConfig.voiceTestMode === "mock"),
    mode: restaurantCallTestConfig.voiceTestMode,
    provider: restaurantCallTestConfig.voiceTestProvider,
    callId: readString(payload, "callId") || null,
    status: readString(payload, "status", "idle"),
    summary: readString(payload, "summary"),
    message: readString(payload, "message"),
  };

  if (!result.success) {
    return result;
  }

  if (!result.callId) {
    throw new Error("voice_test_failed");
  }

  return result;
}

export async function getVoiceTestStatus(callId: string): Promise<VoiceTestStatusResult> {
  const response = await fetch(`/api/voice-test/status-live?callId=${encodeURIComponent(callId)}`, {
    method: "GET",
    cache: "no-store",
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(readString(payload, "message", "voice_status_failed"));
  }

  return {
    success: readBoolean(payload, "success", false),
    mode: "live",
    provider: "vapi",
    callId: readString(payload, "callId") || null,
    status: readString(payload, "status", "failed") as VoiceTestRuntimeStatus,
    rawStatus: readString(payload, "rawStatus"),
    endedReason: readString(payload, "endedReason"),
    terminal: readBoolean(payload, "terminal", false),
    summary: readString(payload, "summary"),
    message: readString(payload, "message"),
  };
}
