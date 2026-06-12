import { runReadinessNow, type ReadinessNowAudience } from "@/lib/instagram-dashboard/readiness-now";
import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  validateAccountId,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type ReadinessNowBody = {
  account_id?: unknown;
  audience?: unknown;
  dry_run?: unknown;
};

function readAudience(value: unknown): ReadinessNowAudience {
  return readString(value, "admin").toLowerCase() === "client" ? "client" : "admin";
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const, userId: null };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    const response = jsonError("Readiness relay authentication failed.", 403, { reason: relayAuth.reason });
    return { mode: "unauthorized" as const, response };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  const adminContext = await getInstagramAdminUserContext();
  return { mode: "admin_session" as const, userId: adminContext?.userId ?? null };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const body = await readJsonBody<ReadinessNowBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const actorId = auth.userId;
    const { createSupabaseClient } = await import("@/lib/supabase");
    const result = await runReadinessNow(createSupabaseClient(), {
      accountId,
      audience: readAudience(body?.audience),
      actorId,
      dryRun: readBoolean(body?.dry_run, true),
    });

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run readiness check.";
    return jsonError(sanitizeRunControlReason(message, "Could not run readiness check."), 500);
  }
}
