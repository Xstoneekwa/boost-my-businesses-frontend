import { assignNowForAccount } from "@/lib/instagram-dashboard/assign-now";
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

type AssignNowBody = {
  account_id?: unknown;
};

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<AssignNowBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const adminContext = await getInstagramAdminUserContext();
    const result = await assignNowForAccount(createSupabaseClient(), accountId, adminContext?.userId ?? null);
    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not assign account now.";
    return jsonError(sanitizeRunControlReason(message, "Could not assign account now."), 500);
  }
}
