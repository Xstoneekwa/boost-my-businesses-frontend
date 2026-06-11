import { createSupabaseClient } from "@/lib/supabase";
import { canAccessTenantPages } from "@/lib/restaurant-analytics/session";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  type SupabaseRecord,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type CredentialsSubmitPayload = {
  account_id?: unknown;
  username?: unknown;
  password?: unknown;
  email?: unknown;
  two_factor_secret?: unknown;
  reason?: unknown;
  login_after_save?: unknown;
  provisioning_enabled?: unknown;
  start_run?: unknown;
  dry_run?: unknown;
};

type CredentialsServiceResponse = {
  request_id: string;
  account_id: string;
  provider: string;
  credentials_version: number | null;
  credentials_status: string;
  status: string;
  reauth_required: boolean;
  next_action: string;
  password_status: string;
};

const credentialsTimeoutMs = 9000;
const usernamePattern = /^[a-z0-9._]{1,30}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unsafeReasonPattern = new RegExp(["password", "secret", "token", "authorization", ["service", "role"].join("_"), "vault", "cookie", "session"].join("|"), "i");

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const, userId: null };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    const response = jsonError("Credentials submit relay authentication failed.", 403, { reason: relayAuth.reason });
    return { mode: "unauthorized" as const, response };
  }

  const adminContext = await getInstagramAdminUserContext();
  if (!adminContext) {
    return { mode: "unauthorized" as const, response: jsonError("Authentication required.", 401) };
  }
  if (!canAccessTenantPages(adminContext)) {
    return { mode: "unauthorized" as const, response: jsonError("You are not authorized to access the Instagram dashboard.", 403) };
  }
  return { mode: "admin_session" as const, userId: adminContext.userId ?? null };
}

function credentialsConfig() {
  const url = process.env.INSTAGRAM_CREDENTIALS_API_URL?.trim();
  const token = process.env.INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

function normalizeUsername(value: unknown) {
  return readString(value, "").trim().replace(/^@+/, "").toLowerCase();
}

function safeReason(value: unknown) {
  const reason = readString(value, "botapp_credentials_update").trim().toLowerCase().replace(/[^a-z0-9_:-]/g, "_");
  if (!reason || unsafeReasonPattern.test(reason)) return "botapp_credentials_update";
  return reason.slice(0, 80);
}

function safeCredentialsResponse(value: unknown): CredentialsServiceResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("credentials_invalid_response");
  }
  const row = value as SupabaseRecord;
  const version = Number(row.credentials_version);
  return {
    request_id: readString(row.request_id, ""),
    account_id: readString(row.account_id, ""),
    provider: readString(row.provider, "instagram"),
    credentials_version: Number.isFinite(version) ? version : null,
    credentials_status: readString(row.credentials_status, "unknown"),
    status: readString(row.status, "unknown"),
    reauth_required: row.reauth_required === true,
    next_action: readString(row.next_action, "awaiting_login_verification"),
    password_status: "write_only",
  };
}

async function existingCredentialsState(accountId: string) {
  const supabase = createSupabaseClient();
  const [{ data: account, error: accountError }, { data: credentials, error: credentialsError }] = await Promise.all([
    supabase.from("ig_accounts").select("id,username,status,admin_lifecycle_status").eq("id", accountId).maybeSingle<SupabaseRecord>(),
    supabase
      .from("account_credentials")
      .select("id,status,credentials_version,last_updated_at,last_submitted_at,last_rotated_at")
      .eq("account_id", accountId)
      .eq("provider", "instagram")
      .order("credentials_version", { ascending: false })
      .limit(1)
      .maybeSingle<SupabaseRecord>(),
  ]);
  if (accountError) throw new Error("account_lookup_failed");
  if (!account) throw new Error("account_not_found");
  if (credentialsError) throw new Error("credentials_lookup_failed");
  return { account, credentials: credentials ?? null };
}

async function callCredentialsService(input: {
  accountId: string;
  username: string;
  password: string;
  action: "submit" | "update_password";
  reason: string;
  actorMode: "relay_key" | "admin_session";
  actorId: string | null;
}) {
  const config = credentialsConfig();
  if (!config) throw new Error("credentials_api_not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), credentialsTimeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-Request-Id": `botapp-credentials-${Date.now().toString(36)}`,
      },
      body: JSON.stringify({
        action: input.action,
        account_id: input.accountId,
        username: input.username,
        password: input.password,
        actor_type: input.actorMode === "relay_key" ? "backend" : "admin",
        actor_id: input.actorId,
        external_request_id: `botapp:${input.accountId}:${Date.now().toString(36)}`,
        metadata_safe: {
          flow: "botapp_credentials_update",
          source: "botapp_relay",
          reason: input.reason,
          login_after_save: false,
          provisioning_enabled: false,
          start_run: false,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null) as ({ ok?: unknown; data?: unknown } & SupabaseRecord) | null;
    if (!response.ok || body?.ok !== true) {
      throw new Error(readString(body?.error, "credentials_ingestion_failed"));
    }
    return safeCredentialsResponse(body.data ?? body);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("credentials_ingestion_timeout");
    if (error instanceof Error) throw error;
    throw new Error("credentials_ingestion_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function insertSafeAudit(input: {
  accountId: string;
  action: string;
  reason: string;
  credentialsStatus: string;
  credentialsVersion: number | null;
  requestId: string;
  actorMode: "relay_key" | "admin_session";
  actorId: string | null;
}) {
  const { data } = await createSupabaseClient()
    .from("ig_action_logs")
    .insert({
      account_id: input.accountId,
      run_id: null,
      target_username: null,
      action_type: "botapp_credentials_update_submitted",
      status: "success",
      message: "credentials_saved_write_only",
      payload: {
        source: "botapp_relay",
        action: input.action,
        reason: input.reason,
        credentials_status: input.credentialsStatus,
        credentials_version: input.credentialsVersion,
        request_id: input.requestId,
        actor_type: input.actorMode,
        actor_id: input.actorId,
        login_started: false,
        provisioning_started: false,
        run_started: false,
        secrets_excluded: true,
      },
      created_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle<SupabaseRecord>();
  return readString(data?.id, "");
}

export async function POST(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const payload = (await readJsonBody<CredentialsSubmitPayload>(request)) ?? {};
    const accountId = readString(payload.account_id, "").trim();
    const username = normalizeUsername(payload.username);
    const password = readString(payload.password, "");
    const reason = safeReason(payload.reason);
    const dryRun = readBoolean(payload.dry_run, false);

    if (!uuidPattern.test(accountId)) return jsonError("account_id_invalid", 400);
    if (!usernamePattern.test(username) || username.includes("..")) return jsonError("username_invalid", 400);
    if (!dryRun && (password.length < 6 || password.trim().length < 6)) return jsonError("password_invalid", 400);
    if (readBoolean(payload.login_after_save, false) || readBoolean(payload.provisioning_enabled, false) || readBoolean(payload.start_run, false)) {
      return jsonError("automation_flags_must_be_false", 400);
    }

    const state = await existingCredentialsState(accountId);
    const accountUsername = normalizeUsername(state.account.username);
    if (accountUsername && accountUsername !== username) return jsonError("username_mismatch", 409);
    const status = readString(state.account.status, "").toLowerCase();
    const lifecycle = readString(state.account.admin_lifecycle_status, status).toLowerCase();
    if (["archived", "trashed", "cancelled", "canceled", "deleted"].includes(status) || ["archived", "trashed", "cancelled", "canceled", "deleted"].includes(lifecycle)) {
      return jsonError("account_inactive", 409);
    }

    const currentCredentialStatus = readString(state.credentials?.status, "missing").toLowerCase();
    const action = state.credentials && !["missing", "unknown"].includes(currentCredentialStatus) ? "update_password" as const : "submit" as const;
    if (dryRun) {
      return jsonOk({
        account_id: accountId,
        username,
        credential_status: readString(state.credentials?.status, "not_submitted"),
        password_status: state.credentials ? "would_update" : "would_submit",
        email_status: readString(payload.email, "").trim() ? "skipped_not_supported" : "not_submitted",
        two_factor_status: readString(payload.two_factor_secret, "").trim() ? "skipped_not_supported" : "not_submitted",
        vault_write: "skipped",
        login_started: false,
        provisioning_started: false,
        run_started: false,
        audit_event_id: null,
        dry_run: true,
      });
    }

    const credentials = await callCredentialsService({
      accountId,
      username,
      password,
      action,
      reason,
      actorMode: auth.mode,
      actorId: auth.userId,
    });
    const auditEventId = await insertSafeAudit({
      accountId,
      action,
      reason,
      credentialsStatus: credentials.credentials_status,
      credentialsVersion: credentials.credentials_version,
      requestId: credentials.request_id,
      actorMode: auth.mode,
      actorId: auth.userId,
    });

    return jsonOk({
      account_id: credentials.account_id || accountId,
      username,
      credential_status: credentials.credentials_status,
      credentials_version: credentials.credentials_version,
      password_status: action === "update_password" ? "updated" : "submitted",
      email_status: readString(payload.email, "").trim() ? "skipped_not_supported" : "not_submitted",
      two_factor_status: readString(payload.two_factor_secret, "").trim() ? "skipped_not_supported" : "not_submitted",
      vault_write: "success",
      login_started: false,
      provisioning_started: false,
      run_started: false,
      audit_event_id: auditEventId || null,
      credentials_request_id: credentials.request_id,
      next_action: credentials.next_action,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "credentials_submit_failed";
    return jsonError(message, message === "credentials_api_not_configured" ? 500 : 502);
  }
}
