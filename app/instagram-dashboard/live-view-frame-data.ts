const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const frameEligibleStatuses = new Set(["pending", "starting", "active"]);

export function isLiveViewFrameSessionId(value: string | null | undefined) {
  return typeof value === "string" && uuidRe.test(value.trim());
}

export function canServeLiveViewFrame(input: {
  status: string | null | undefined;
  streamTransport: string | null | undefined;
}) {
  const status = String(input.status || "").trim().toLowerCase();
  const transport = String(input.streamTransport || "").trim().toLowerCase();
  return frameEligibleStatuses.has(status) && transport === "screenshot_polling";
}

export function liveViewFrameObjectPath(sessionId: string) {
  return `${sessionId.trim()}/latest.png`;
}

export function liveViewFrameStorageBucket(env: NodeJS.ProcessEnv = process.env) {
  return env.LIVE_VIEW_FRAME_STORAGE_BUCKET?.trim() || "live-view-frames";
}

export function buildLiveViewFrameUrl(input: {
  accountId: string;
  liveViewSessionId: string;
  cacheBuster?: number;
}) {
  const params = new URLSearchParams({
    account_id: input.accountId,
    live_view_session_id: input.liveViewSessionId,
  });
  if (input.cacheBuster != null) {
    params.set("t", String(input.cacheBuster));
  }
  return `/api/instagram-dashboard/live-view/frame?${params.toString()}`;
}

export function liveViewPanelMessage(input: {
  status: string;
  streamTransport?: string | null;
  failureReason?: string | null;
}) {
  const status = String(input.status || "").trim().toLowerCase();
  if (status === "pending") return "Waiting for stream";
  if (status === "starting") return "Starting stream";
  if (status === "active") {
    return input.streamTransport === "screenshot_polling"
      ? "Live view stream"
      : "Stream token ready. LV-Web-2B will attach the WebRTC player here.";
  }
  if (status === "failed") return input.failureReason?.trim() || "Live view failed";
  if (status === "stopped") return "Live view stopped";
  if (status === "expired") return "Live view expired";
  return "Live view unavailable";
}
