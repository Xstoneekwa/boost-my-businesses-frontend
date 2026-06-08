import { runReadinessNow, type ReadinessNowAudience } from "@/lib/instagram-dashboard/readiness-now";
import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  validateAccountId,
} from "../../_utils";

export const dynamic = "force-dynamic";

type ReadinessNowBody = {
  account_id?: unknown;
  audience?: unknown;
};

function readAudience(value: unknown): ReadinessNowAudience {
  return readString(value, "admin").toLowerCase() === "client" ? "client" : "admin";
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<ReadinessNowBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const adminContext = await getInstagramAdminUserContext();
    const actorId = adminContext?.userId ?? null;
    const { createSupabaseClient } = await import("@/lib/supabase");
    const result = await runReadinessNow(createSupabaseClient(), {
      accountId,
      audience: readAudience(body?.audience),
      actorId,
    });

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run readiness check.";
    return jsonError(sanitizeRunControlReason(message, "Could not run readiness check."), 500);
  }
}
