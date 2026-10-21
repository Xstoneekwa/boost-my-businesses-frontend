import { NextResponse } from "next/server";
import { CommercialCrmAccessError } from "./crm-access";
/** Only expose our validation codes; never return SQL details or provider contents. */
export function followupApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const auth = error instanceof CommercialCrmAccessError;
  const safe = /^[a-z][a-z0-9_]{2,100}$/.test(message);
  const status = auth
    ? error.status
    : /conflict|stale/.test(message)
      ? 409
      : /storage|commit_failed|unavailable/.test(message)
        ? 503
        : 400;
  return NextResponse.json(
    {
      ok: false,
      code: auth
        ? error.code
        : safe
          ? message
          : "commercial_followup_request_failed",
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
