/**
 * CP4 — Session transition buffer (T-10) derived from materialized window timestamps.
 *
 * All calculations use absolute ISO timestamps from the dated assignment window.
 * Display layers may format via IANA timezone; no hard-coded regional offsets.
 */

export const SESSION_TRANSITION_BUFFER_MINUTES = 10;

export type SessionTransitionTimestamps = {
  session_start: string;
  session_end: string;
  business_action_deadline: string;
  preflight_start: string;
};

export type SessionTransitionPhase =
  | "before_preflight"
  | "preflight_due"
  | "session_open"
  | "transition_buffer_active"
  | "session_ended";

export function deriveSessionTransitionTimestamps(
  sessionStart: string,
  sessionEnd: string,
  bufferMinutes = SESSION_TRANSITION_BUFFER_MINUTES,
): SessionTransitionTimestamps | null {
  const startMs = Date.parse(sessionStart);
  const endMs = Date.parse(sessionEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const bufferMs = Math.max(1, bufferMinutes) * 60_000;
  if (endMs - startMs <= bufferMs) return null;
  return {
    session_start: new Date(startMs).toISOString(),
    session_end: new Date(endMs).toISOString(),
    business_action_deadline: new Date(endMs - bufferMs).toISOString(),
    preflight_start: new Date(startMs - bufferMs).toISOString(),
  };
}

export function isWithinPreflightWindow(now: Date, timestamps: SessionTransitionTimestamps) {
  const nowMs = now.getTime();
  return nowMs >= Date.parse(timestamps.preflight_start) && nowMs < Date.parse(timestamps.session_start);
}

export function isBusinessActionsAllowed(now: Date, timestamps: SessionTransitionTimestamps) {
  return now.getTime() < Date.parse(timestamps.business_action_deadline);
}

export function isTransitionBufferActive(now: Date, timestamps: SessionTransitionTimestamps) {
  const nowMs = now.getTime();
  return nowMs >= Date.parse(timestamps.business_action_deadline) && nowMs < Date.parse(timestamps.session_end);
}

export function isSessionOpen(now: Date, timestamps: SessionTransitionTimestamps) {
  const nowMs = now.getTime();
  return nowMs >= Date.parse(timestamps.session_start) && nowMs < Date.parse(timestamps.session_end);
}

export function classifySessionTransitionPhase(
  now: Date,
  timestamps: SessionTransitionTimestamps,
): SessionTransitionPhase {
  const nowMs = now.getTime();
  if (nowMs < Date.parse(timestamps.preflight_start)) return "before_preflight";
  if (isWithinPreflightWindow(now, timestamps)) return "preflight_due";
  if (isTransitionBufferActive(now, timestamps)) return "transition_buffer_active";
  if (nowMs >= Date.parse(timestamps.session_end)) return "session_ended";
  if (isSessionOpen(now, timestamps)) return "session_open";
  return "before_preflight";
}

export function sessionTransitionMetadata(
  sessionStart: string,
  sessionEnd: string,
  bufferMinutes = SESSION_TRANSITION_BUFFER_MINUTES,
) {
  const timestamps = deriveSessionTransitionTimestamps(sessionStart, sessionEnd, bufferMinutes);
  if (!timestamps) return null;
  return {
    scheduled_session_start: timestamps.session_start,
    scheduled_session_end: timestamps.session_end,
    business_action_deadline: timestamps.business_action_deadline,
    preflight_start: timestamps.preflight_start,
    transition_buffer_minutes: bufferMinutes,
  };
}
