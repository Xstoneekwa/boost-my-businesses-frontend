import { connectNowForAccount } from "@/lib/instagram-dashboard/connect-now";
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

type ConnectNowBody = {
  account_id?: unknown;
};

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<ConnectNowBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const adminContext = await getInstagramAdminUserContext();
    const { createSupabaseClient } = await import("@/lib/supabase");
    const result = await connectNowForAccount(createSupabaseClient(), {
      accountId,
      actorId: adminContext?.userId ?? null,
    });

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect Instagram now.";
    return jsonError(sanitizeRunControlReason(message, "Could not connect Instagram now."), 500);
  }
}
