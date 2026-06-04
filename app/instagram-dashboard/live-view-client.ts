export type LiveViewStatus =
  | "inactive"
  | "pending"
  | "starting"
  | "active"
  | "stopped"
  | "failed"
  | "expired"
  | "livekit_not_configured";

export type LiveViewMode = "view_only" | "interactive";

export type LiveViewSessionSafe = {
  ok: true;
  live_view_session_id: string;
  status: LiveViewStatus;
  mode: LiveViewMode;
  stream_transport: string;
  username: string;
  device_label: string;
  clone_label: string;
  package_name: string | null;
  package_label: string | null;
  run_active_at_start: boolean;
  interaction_enabled: boolean;
  expires_at: string | null;
  failure_reason: string | null;
  active?: boolean;
};

export type LiveViewTokenSafe = {
  ok: true;
  live_view_session_id: string;
  status: LiveViewStatus;
  livekit_url: string;
  livekit_token: string;
  livekit_room_name: string;
  expires_in_seconds: number;
  subscribe_only: boolean;
};

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

async function readLiveViewApi<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!payload) throw new Error(fallback);
  if (payload.ok) return payload.data;
  const error = new Error(payload.error || fallback);
  error.name = payload.code || "live_view_error";
  throw error;
}

export function isLiveViewActiveStatus(status: string | null | undefined) {
  return status === "pending" || status === "starting" || status === "active";
}

export function shouldKeepLiveViewSession(status: string | null | undefined) {
  return isLiveViewActiveStatus(status) || status === "livekit_not_configured";
}

export function liveViewEyeTone(status: string | null | undefined) {
  return isLiveViewActiveStatus(status) ? "success" : "neutral";
}

export function liveViewTooltip(input: {
  status?: string | null;
  runActive?: boolean;
  phoneUnavailable?: boolean;
  livekitNotConfigured?: boolean;
}) {
  if (input.livekitNotConfigured) return "LiveKit not configured";
  if (input.phoneUnavailable) return "Phone unavailable";
  if (input.runActive) return "Run active - view only";
  if (isLiveViewActiveStatus(input.status)) return "Live view active";
  return "Open live view";
}

const liveViewFetchInit: RequestInit = {
  credentials: "include",
  headers: { Accept: "application/json" },
};

export async function startLiveView(accountId: string) {
  return readLiveViewApi<LiveViewSessionSafe>(
    await fetch("/api/instagram-dashboard/live-view/start", {
      ...liveViewFetchInit,
      method: "POST",
      headers: {
        ...liveViewFetchInit.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        mode: "view_only",
        source: "manager_row_eye",
      }),
    }),
    "Could not start live view.",
  );
}

export async function stopLiveView(input: {
  accountId: string;
  liveViewSessionId?: string;
}) {
  return readLiveViewApi<LiveViewSessionSafe>(
    await fetch("/api/instagram-dashboard/live-view/stop", {
      ...liveViewFetchInit,
      method: "POST",
      headers: {
        ...liveViewFetchInit.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_id: input.accountId,
        live_view_session_id: input.liveViewSessionId ?? null,
      }),
    }),
    "Could not stop live view.",
  );
}

export async function loadLiveViewStatus(accountId: string) {
  return readLiveViewApi<LiveViewSessionSafe>(
    await fetch(`/api/instagram-dashboard/live-view/status?account_id=${encodeURIComponent(accountId)}`, {
      ...liveViewFetchInit,
    }),
    "Could not load live view status.",
  );
}

export async function requestLiveViewToken(liveViewSessionId: string) {
  return readLiveViewApi<LiveViewTokenSafe>(
    await fetch("/api/instagram-dashboard/live-view/token", {
      ...liveViewFetchInit,
      method: "POST",
      headers: {
        ...liveViewFetchInit.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ live_view_session_id: liveViewSessionId }),
    }),
    "Could not reconnect live view.",
  );
}
