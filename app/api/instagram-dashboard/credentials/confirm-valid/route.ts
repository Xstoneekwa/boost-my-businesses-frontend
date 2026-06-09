import { confirmValidCredentials } from "@/lib/instagram-dashboard/credentials-confirm-valid";
import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import { createSupabaseClient } from "@/lib/supabase";
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

type ConfirmValidBody = {
  account_id?: unknown;
};

const conflictStatuses = new Set([
  "account_lifecycle_blocked",
  "credentials_missing",
  "credentials_inactive",
  "update_failed",
]);

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<ConfirmValidBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const adminContext = await getInstagramAdminUserContext();
    const result = await confirmValidCredentials(createSupabaseClient(), {
      accountId,
      actorId: adminContext?.userId ?? null,
    });

    if (result.status === "account_not_found") {
      return jsonError(result.message, 404, { data: result });
    }
    if (conflictStatuses.has(result.status)) {
      return jsonError(result.message, 409, { data: result });
    }

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not confirm credentials.";
    return jsonError(sanitizeRunControlReason(message, "Could not confirm credentials."), 500);
  }
}
