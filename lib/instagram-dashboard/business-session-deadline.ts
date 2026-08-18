export const BUSINESS_SESSION_TRANSITION_BUFFER_SECONDS = 10 * 60;

function parseBoundary(value: string | null | undefined) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) throw new Error("business_session_boundary_invalid");
  return ms;
}

/** Scheduler-owned, canonical end of business actions for one device session. */
export function resolveCanonicalBusinessActionDeadline(input: {
  scheduleWindowEndsAt: string;
  nextDeviceReservationAt?: string | null;
  explicitSafetyBoundaryAt?: string | null;
  transitionBufferSeconds?: number;
}) {
  const boundaries = [parseBoundary(input.scheduleWindowEndsAt)];
  if (input.nextDeviceReservationAt) boundaries.push(parseBoundary(input.nextDeviceReservationAt));
  if (input.explicitSafetyBoundaryAt) boundaries.push(parseBoundary(input.explicitSafetyBoundaryAt));
  const transitionSeconds = Math.max(
    1,
    Math.trunc(input.transitionBufferSeconds ?? BUSINESS_SESSION_TRANSITION_BUFFER_SECONDS),
  );
  return new Date(Math.min(...boundaries) - transitionSeconds * 1000).toISOString();
}
