import { createSupabaseClient } from "../supabase.ts";
import { resolveServerCredentialsConfig } from "../instagram-credentials/server-credentials-config.ts";
import { readString } from "./guards";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITABLE_STATUSES = new Set(["pending", "acknowledged"]);
const REPLAY_STATUS = "pending_verification";

type Row = Record<string, unknown>;

export type ClientPasswordUpdateResult =
  | {
      ok: true;
      accountId: string;
      actionId: string;
      credentialsVersion: number;
      actionStatus: "pending_verification";
      nextAction: "awaiting_login_verification";
      idempotentReplay: boolean;
    }
  | { ok: false; status: number; code: string; message: string };

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function safeFailure(status: number, code: string, message: string): ClientPasswordUpdateResult {
  return { ok: false, status, code, message };
}

export async function updateClientInstagramPassword(input: {
  actorUserId: string;
  clientId: string;
  accountId: string;
  actionId: string;
  password: string;
  fetcher?: typeof fetch;
  supabase?: ReturnType<typeof createSupabaseClient>;
  credentialsConfig?: { url: string; token: string } | null;
}): Promise<ClientPasswordUpdateResult> {
  if (!UUID_RE.test(input.actorUserId) || !UUID_RE.test(input.accountId) || !UUID_RE.test(input.actionId)) {
    return safeFailure(400, "password_update_identity_invalid", "Invalid password update request.");
  }
  if (typeof input.password !== "string" || input.password.length < 6 || input.password.length > 4096) {
    return safeFailure(400, "password_invalid", "Enter a valid Instagram password.");
  }

  const supabase = input.supabase ?? createSupabaseClient();
  const [{ data: action, error: actionError }, { data: account, error: accountError }] = await Promise.all([
    supabase
      .from("account_dashboard_actions")
      .select("id,account_id,client_id,incident_id,action_type,status,requires_client_action,metadata")
      .eq("id", input.actionId)
      .eq("account_id", input.accountId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("ig_accounts")
      .select("id,username,status,admin_lifecycle_status")
      .eq("id", input.accountId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (actionError || accountError) {
    return safeFailure(503, "password_update_state_unavailable", "Password update is temporarily unavailable.");
  }
  if (!action || !account) {
    return safeFailure(404, "password_update_action_not_found", "Password update action not found.");
  }

  const actionRow = record(action);
  const accountRow = record(account);
  if (readString(actionRow.client_id) && readString(actionRow.client_id) !== input.clientId) {
    return safeFailure(403, "password_update_action_tenant_mismatch", "This action does not belong to your workspace.");
  }
  if (readString(actionRow.action_type).toLowerCase() !== "update_instagram_password") {
    return safeFailure(409, "password_update_action_type_invalid", "This action cannot update a password.");
  }
  const actionStatus = readString(actionRow.status).toLowerCase();
  const writable = WRITABLE_STATUSES.has(actionStatus) && actionRow.requires_client_action === true;
  const replayable = actionStatus === REPLAY_STATUS && actionRow.requires_client_action === false;
  if (!writable && !replayable) {
    return safeFailure(409, "password_update_action_inactive", "This password update action is no longer active.");
  }

  const lifecycle = readString(accountRow.admin_lifecycle_status, readString(accountRow.status)).toLowerCase();
  if (["archived", "trashed", "cancelled", "canceled", "deleted"].includes(lifecycle)) {
    return safeFailure(409, "account_inactive", "This Instagram account is inactive.");
  }

  const config = input.credentialsConfig === undefined
    ? resolveServerCredentialsConfig()
    : input.credentialsConfig;
  if (!config) {
    return safeFailure(503, "credentials_api_not_configured", "Password update is temporarily unavailable.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await (input.fetcher ?? fetch)(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": `client-password-update-${input.actionId}`,
      },
      body: JSON.stringify({
        action: "update_password",
        account_id: input.accountId,
        action_id: input.actionId,
        username: readString(accountRow.username).replace(/^@+/, "").toLowerCase(),
        password: input.password,
        actor_type: "client",
        actor_id: input.actorUserId,
        external_request_id: `password-update:${input.actionId}`,
        metadata_safe: {
          source: "client_dashboard",
          flow: "wrong_password_recovery",
          login_after_save: false,
          start_run: false,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = record(await response.json().catch(() => null));
    if (!response.ok || body.ok !== true) {
      return safeFailure(
        response.status >= 400 && response.status < 500 ? response.status : 502,
        readString(body.error, "credentials_rotation_failed"),
        "The password could not be saved. Please try again.",
      );
    }
    const version = Number(body.credentials_version);
    if (!Number.isInteger(version) || version < 1 || readString(body.account_id) !== input.accountId) {
      return safeFailure(502, "credentials_rotation_invalid_response", "The password update could not be confirmed.");
    }
    return {
      ok: true,
      accountId: input.accountId,
      actionId: input.actionId,
      credentialsVersion: version,
      actionStatus: "pending_verification",
      nextAction: "awaiting_login_verification",
      idempotentReplay: body.idempotent_replay === true,
    };
  } catch (error) {
    return safeFailure(
      502,
      error instanceof Error && error.name === "AbortError" ? "credentials_rotation_timeout" : "credentials_rotation_failed",
      "The password could not be saved. Please try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
