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
  stream_transport: "webrtc" | "mjpeg" | "screenshot_polling";
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

export type LiveViewSafeError = {
  ok: false;
  code: string;
  message: string;
  status: number;
};

type AdminDashboardConfig = {
  url: string;
  token: string;
};

const liveViewActions = new Set([
  "live_view_start",
  "live_view_stop",
  "live_view_status",
  "live_view_token",
]);
const activeStatuses = new Set(["pending", "starting", "active"]);
const adminDashboardTokenEnv = ["ADMIN_DASHBOARD", "INTERNAL_API_TOKEN"].join("_");
const safeErrorMessages: Record<string, string> = {
  assignment_not_found: "Live view is unavailable because no phone assignment is active for this account.",
  live_view_session_already_active: "A live view session is already active for this phone.",
  conflict: "A live view session is already active for this phone.",
  livekit_not_configured: "LiveKit is not configured yet. Session foundation is ready.",
  unauthorized: "Admin dashboard API auth is not configured correctly.",
  device_unavailable: "Phone unavailable.",
  session_not_found: "Live view session not found.",
  session_not_active: "Live view session is not active.",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readBoolean(row: Record<string, unknown>, key: string, fallback = false) {
  const value = row[key];
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(row: Record<string, unknown>, key: string, fallback = 0) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readLiveViewStatus(value: unknown): LiveViewStatus {
  const status = readString(value, "inactive");
  if (
    status === "pending" ||
    status === "starting" ||
    status === "active" ||
    status === "stopped" ||
    status === "failed" ||
    status === "expired" ||
    status === "livekit_not_configured"
  ) {
    return status;
  }
  return "inactive";
}

function readMode(value: unknown): LiveViewMode {
  return readString(value, "view_only") === "interactive" ? "interactive" : "view_only";
}

function readTransport(value: unknown): "webrtc" | "mjpeg" | "screenshot_polling" {
  const transport = readString(value, "webrtc");
  if (transport === "mjpeg" || transport === "screenshot_polling") return transport;
  return "webrtc";
}

function safeError(code: string, status: number): LiveViewSafeError {
  return {
    ok: false,
    code,
    message: safeErrorMessages[code] || "Live view request failed.",
    status: status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 503 ? status : 502,
  };
}

export function liveViewStartPayload(input: {
  accountId: string;
  mode?: LiveViewMode;
  source?: string;
  actorId?: string | null;
}) {
  return {
    action: "live_view_start" as const,
    account_id: input.accountId,
    mode: input.mode ?? "view_only",
    source: input.source ?? "manager_row_eye",
    actor_id: input.actorId ?? null,
    requested_by: input.actorId ?? "admin_dashboard",
  };
}

export function liveViewStopPayload(input: {
  accountId?: string | null;
  liveViewSessionId?: string | null;
  actorId?: string | null;
}) {
  return {
    action: "live_view_stop" as const,
    account_id: input.accountId ?? null,
    live_view_session_id: input.liveViewSessionId ?? null,
    actor_id: input.actorId ?? null,
  };
}

export function liveViewStatusPayload(accountId: string) {
  return { action: "live_view_status" as const, account_id: accountId };
}

export function liveViewTokenPayload(input: {
  liveViewSessionId: string;
  actorId?: string | null;
}) {
  return {
    action: "live_view_token" as const,
    live_view_session_id: input.liveViewSessionId,
    actor_id: input.actorId ?? null,
  };
}

export function safeLiveViewSession(payload: unknown): LiveViewSessionSafe {
  const row = asRecord(payload);
  return {
    ok: true,
    live_view_session_id: readString(row.live_view_session_id, ""),
    status: readLiveViewStatus(row.status),
    mode: readMode(row.mode),
    stream_transport: readTransport(row.stream_transport),
    username: readString(row.username, "Instagram account"),
    device_label: readString(row.device_label, "Phone"),
    clone_label: readString(row.clone_label, readString(row.package_label, "clone")),
    package_name: readString(row.package_name, "") || null,
    package_label: readString(row.package_label, readString(row.clone_label, "")) || null,
    run_active_at_start: readBoolean(row, "run_active_at_start"),
    interaction_enabled: readBoolean(row, "interaction_enabled"),
    expires_at: readString(row.expires_at, "") || null,
    failure_reason: readString(row.failure_reason, "") || null,
    active: readBoolean(row, "active", activeStatuses.has(readString(row.status))),
  };
}

export function safeLiveViewToken(payload: unknown): LiveViewTokenSafe | LiveViewSafeError {
  const row = asRecord(payload);
  if (row.ok === false) {
    const error = asRecord(row.error);
    const code = readString(error.code, "live_view_failed");
    return safeError(code, code === "livekit_not_configured" ? 503 : 502);
  }

  return {
    ok: true,
    live_view_session_id: readString(row.live_view_session_id, ""),
    status: readLiveViewStatus(row.status),
    livekit_url: readString(row.livekit_url, ""),
    livekit_token: readString(row.livekit_token, ""),
    livekit_room_name: readString(row.livekit_room_name, ""),
    expires_in_seconds: Math.max(0, Math.trunc(readNumber(row, "expires_in_seconds", 0))),
    subscribe_only: readBoolean(row, "subscribe_only", true),
  };
}

function adminDashboardErrorMessage(error: unknown, status: number) {
  const row = asRecord(error);
  const code = readString(row.code, readString(row.message, ""));
  return safeError(code || "live_view_failed", status);
}

export async function forwardLiveViewToAdminDashboard(
  body: Record<string, unknown>,
  config: AdminDashboardConfig,
  fetcher: typeof fetch = fetch,
) {
  const action = readString(body.action);
  if (!liveViewActions.has(action)) {
    return safeError("live_view_action_invalid", 400);
  }

  const response = await fetcher(config.url, {
    method: "POST",
    headers: {
      apikey: config.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (action === "live_view_token") {
    if (response.ok || readString(asRecord(payload.error).code) === "livekit_not_configured") {
      return safeLiveViewToken(payload);
    }
    return adminDashboardErrorMessage(payload.error, response.status);
  }

  if (!response.ok || payload.ok !== true) {
    return adminDashboardErrorMessage(payload.error, response.status);
  }

  return safeLiveViewSession(payload);
}

export function adminDashboardConfig(env: NodeJS.ProcessEnv = process.env): AdminDashboardConfig | null {
  const explicitUrl = env.ADMIN_DASHBOARD_API_URL?.trim();
  const baseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const url = explicitUrl || (baseUrl ? `${baseUrl}/functions/v1/admin-dashboard` : "");
  const token = env[adminDashboardTokenEnv]?.trim();

  if (!url || !token) return null;
  return { url, token };
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
