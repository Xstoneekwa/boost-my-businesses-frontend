export type ConfirmValidCredentialsStatus =
  | "confirmed"
  | "already_confirmed"
  | "account_not_found"
  | "account_lifecycle_blocked"
  | "credentials_missing"
  | "credentials_inactive"
  | "update_failed";

export type ConfirmValidCredentialsResult = {
  account_id: string;
  status: ConfirmValidCredentialsStatus;
  credentials_status: string | null;
  reauth_required: boolean | null;
  reauth_reason: string | null;
  next_action: "run_readiness_now" | "none" | "review_account" | "submit_or_update_credentials" | "retry";
  message: string;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => PromiseLike<QueryResult>;
  update?: (patch: Record<string, unknown>) => QueryBuilder;
  insert?: (row: Record<string, unknown>) => PromiseLike<QueryResult>;
};

export type ConfirmValidCredentialsSupabase = {
  from: (table: string) => unknown;
};

type Row = Record<string, unknown>;

const blockedLifecycleStatuses = new Set([
  "archived",
  "trashed",
  "deleted",
  "cancelled",
  "canceled",
]);

function query(supabase: ConfirmValidCredentialsSupabase, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function readRow(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function normalize(value: unknown) {
  return readString(value).toLowerCase();
}

function safeResult(input: ConfirmValidCredentialsResult): ConfirmValidCredentialsResult {
  return input;
}

function auditPayload(input: {
  actorId: string | null;
  previousReauthRequired: boolean | null;
  previousReauthReason: string | null;
}) {
  return {
    actor_type: "admin",
    actor_id: input.actorId,
    source_surface: "instagram_dashboard_credentials_confirm_valid",
    previous_reauth_required: input.previousReauthRequired,
    previous_reauth_reason: input.previousReauthReason,
  };
}

async function tryAudit(
  supabase: ConfirmValidCredentialsSupabase,
  accountId: string,
  actorId: string | null,
  credential: Row,
) {
  const insert = query(supabase, "ig_action_logs").insert;
  if (!insert) return;
  try {
    await insert.call(query(supabase, "ig_action_logs"), {
      account_id: accountId,
      run_id: null,
      target_username: null,
      action_type: "credentials_confirmed_valid",
      status: "success",
      message: "credentials_confirmed_valid",
      payload: auditPayload({
        actorId,
        previousReauthRequired: typeof credential.reauth_required === "boolean" ? credential.reauth_required : null,
        previousReauthReason: readString(credential.reauth_reason, "") || null,
      }),
      created_at: new Date().toISOString(),
    });
  } catch {
    // Credential state is authoritative; audit failures must not keep the account blocked.
  }
}

export async function confirmValidCredentials(
  supabase: ConfirmValidCredentialsSupabase,
  input: { accountId: string; actorId?: string | null },
): Promise<ConfirmValidCredentialsResult> {
  const accountId = input.accountId.trim();
  const { data: accountData, error: accountError } = await query(supabase, "ig_accounts")
    .select("id,status,admin_lifecycle_status")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message || "account_lookup_failed");

  const account = readRow(accountData);
  if (!account) {
    return safeResult({
      account_id: accountId,
      status: "account_not_found",
      credentials_status: null,
      reauth_required: null,
      reauth_reason: null,
      next_action: "review_account",
      message: "Instagram account not found.",
    });
  }

  const accountStatus = normalize(account.status);
  const lifecycleStatus = normalize(account.admin_lifecycle_status || account.status);
  if (blockedLifecycleStatuses.has(accountStatus) || blockedLifecycleStatuses.has(lifecycleStatus)) {
    return safeResult({
      account_id: accountId,
      status: "account_lifecycle_blocked",
      credentials_status: null,
      reauth_required: null,
      reauth_reason: null,
      next_action: "review_account",
      message: "Inactive accounts cannot have credentials confirmed.",
    });
  }

  const { data: credentialData, error: credentialError } = await query(supabase, "account_credentials")
    .select("account_id,status,reauth_required,reauth_reason,credentials_version,updated_at")
    .eq("account_id", accountId)
    .eq("provider", "instagram")
    .order("credentials_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (credentialError) throw new Error(credentialError.message || "credential_lookup_failed");

  const credential = readRow(credentialData);
  if (!credential) {
    return safeResult({
      account_id: accountId,
      status: "credentials_missing",
      credentials_status: null,
      reauth_required: null,
      reauth_reason: null,
      next_action: "submit_or_update_credentials",
      message: "Active Instagram credentials are missing.",
    });
  }

  const credentialsStatus = normalize(credential.status);
  if (credentialsStatus !== "active") {
    return safeResult({
      account_id: accountId,
      status: "credentials_inactive",
      credentials_status: credentialsStatus || "unknown",
      reauth_required: typeof credential.reauth_required === "boolean" ? credential.reauth_required : null,
      reauth_reason: readString(credential.reauth_reason, "") || null,
      next_action: "submit_or_update_credentials",
      message: "Instagram credentials are not active.",
    });
  }

  if (credential.reauth_required !== true && !readString(credential.reauth_reason, "")) {
    return safeResult({
      account_id: accountId,
      status: "already_confirmed",
      credentials_status: "active",
      reauth_required: false,
      reauth_reason: null,
      next_action: "run_readiness_now",
      message: "Credentials were already confirmed valid.",
    });
  }

  const nowIso = new Date().toISOString();
  const credentialUpdate = query(supabase, "account_credentials");
  const { data: updatedData, error: updateError } = credentialUpdate.update
    ? await credentialUpdate
      .update({
      reauth_required: false,
      reauth_reason: null,
      updated_at: nowIso,
      last_updated_at: nowIso,
      updated_by_actor_type: "admin",
      updated_by_actor_id: input.actorId ?? null,
    })
      .eq("account_id", accountId)
      .eq("provider", "instagram")
      .eq("status", "active")
      .select("account_id,status,reauth_required,reauth_reason,credentials_version,updated_at")
      .maybeSingle()
    : { data: null, error: { message: "credential_update_unavailable" } };
  if (updateError) {
    return safeResult({
      account_id: accountId,
      status: "update_failed",
      credentials_status: "active",
      reauth_required: true,
      reauth_reason: readString(credential.reauth_reason, "") || null,
      next_action: "retry",
      message: "Credentials confirmation could not be saved.",
    });
  }

  const updated = readRow(updatedData);
  if (!updated) {
    return safeResult({
      account_id: accountId,
      status: "update_failed",
      credentials_status: "active",
      reauth_required: true,
      reauth_reason: readString(credential.reauth_reason, "") || null,
      next_action: "retry",
      message: "Credentials confirmation could not be saved.",
    });
  }

  await tryAudit(supabase, accountId, input.actorId ?? null, credential);

  return safeResult({
    account_id: accountId,
    status: "confirmed",
    credentials_status: "active",
    reauth_required: false,
    reauth_reason: null,
    next_action: "run_readiness_now",
    message: "Credentials confirmed valid. Run readiness now can continue to the next gate.",
  });
}
