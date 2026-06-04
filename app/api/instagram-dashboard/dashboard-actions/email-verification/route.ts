import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

type DashboardActionRow = {
  id?: unknown;
  account_id?: unknown;
  action_type?: unknown;
  status?: unknown;
  title?: unknown;
  safe_client_message?: unknown;
  updated_at?: unknown;
  metadata?: unknown;
};

type AccountRow = {
  id?: unknown;
  username?: unknown;
};

type DeletePayload = {
  action_id?: unknown;
  account_id?: unknown;
};

const ACTIVE_EMAIL_CODE_STATUSES = ["pending", "acknowledged", "pending_verification", "code_submitted"] as const;

export async function GET() {
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return unauthorizedResponse;

  const supabase = createSupabaseClient();
  const { data: actionRows, error: actionsError } = await supabase
    .from("account_dashboard_actions")
    .select("id,account_id,action_type,status,title,safe_client_message,updated_at,metadata")
    .eq("action_type", "enter_email_verification_code")
    .in("status", [...ACTIVE_EMAIL_CODE_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(20);

  if (actionsError) {
    return jsonError("Email verification actions unavailable.", 503);
  }

  const actions = Array.isArray(actionRows) ? (actionRows as DashboardActionRow[]) : [];
  const accountIds = [...new Set(actions.map((row) => readString(row.account_id)).filter(Boolean))];
  let accountById = new Map<string, string>();

  if (accountIds.length > 0) {
    const { data: accountsData, error: accountsError } = await supabase
      .from("ig_accounts")
      .select("id,username")
      .in("id", accountIds);

    if (!accountsError && Array.isArray(accountsData)) {
      const accountEntries: Array<[string, string]> = [];
      for (const row of accountsData as AccountRow[]) {
        const id = readString(row.id);
        const username = readString(row.username);
        if (id && username) accountEntries.push([id, username]);
      }
      accountById = new Map(accountEntries);
    }
  }

  return jsonOk({
    actions: actions.map((row) => {
      const accountId = readString(row.account_id);
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      const resumeStatus = readString(metadata.resume_status, "");
      return {
        id: readString(row.id),
        accountId,
        username: accountById.get(accountId) || "Instagram account",
        actionType: "enter_email_verification_code",
        status: readString(row.status, "pending"),
        resumeStatus: resumeStatus || null,
        resumeRequestId: readString(metadata.resume_request_id, "") || null,
        title: readString(row.title, "Email verification code required"),
        description: readString(row.safe_client_message, "Instagram is waiting for an email verification code."),
      };
    }),
  });
}

export async function DELETE(request: Request) {
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return unauthorizedResponse;

  const payload = (await readJsonBody<DeletePayload>(request)) ?? {};
  const actionId = readString(payload.action_id);
  const accountId = readString(payload.account_id);

  if (!actionId || !accountId) {
    return jsonError("Missing email verification action id.", 400);
  }

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_dashboard_actions")
    .update({
      status: "dismissed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .eq("account_id", accountId)
    .eq("action_type", "enter_email_verification_code")
    .in("status", [...ACTIVE_EMAIL_CODE_STATUSES])
    .select("id,status")
    .maybeSingle();

  if (error) {
    return jsonError("Could not dismiss email verification action.", 500);
  }

  if (!data) {
    return jsonError("Email verification action is no longer pending.", 409);
  }

  return jsonOk({
    action_id: actionId,
    status: "dismissed",
  });
}
