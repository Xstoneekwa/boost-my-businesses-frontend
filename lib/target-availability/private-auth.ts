import { timingSafeEqual } from "node:crypto";

export const TARGET_AVAILABILITY_PRIVATE_TOKEN_HEADER = "x-instagram-auto-restart-tick-token";

export function targetAvailabilityPrivateRequestAuthorized(request: Request) {
  const expected = String(process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN ?? "").trim();
  const provided = String(request.headers.get(TARGET_AVAILABILITY_PRIVATE_TOKEN_HEADER) ?? "").trim();
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
