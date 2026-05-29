import { createSupabaseClient } from "@/lib/supabase";
import { defaultInstagramFilters, defaultInstagramSettings } from "@/lib/instagram-dashboard/defaults";
import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, type SupabaseRecord } from "../../_utils";

export const dynamic = "force-dynamic";

type CreateProfilePayload = {
  username?: unknown;
  password?: unknown;
  email?: unknown;
  display_name?: unknown;
  internal_label?: unknown;
  notes?: unknown;
  login_method?: unknown;
  clone_mode?: unknown;
  device_id?: unknown;
  device_name?: unknown;
  device_udid?: unknown;
  template_mode?: unknown;
  template_id?: unknown;
};

type AddProfileCredentialsResponse = {
  request_id: string;
  account_id: string;
  provider: string;
  credentials_version: string;
  credentials_status: string;
  status: string;
  reauth_required: boolean;
  next_action: string;
  password_status: "write_only";
};

type AddProfileCredentialsInput = {
  accountId: string;
  expectedUsername: string;
  password: string;
  actorType: "admin";
  externalRequestId: string;
};

const credentialsTimeoutMs = 9000;
const activeAccountStatus = "active";
const supportRequiredStatus = "support_required";
const sensitivePayloadKeys = new Set([
  "password",
  "email",
  "device_udid",
  "app_package",
  "secret_ref",
  "vault_id",
  "vault_value",
  "token",
  "authorization",
  "service_role",
  "metadata",
  "metadata_safe",
  "raw_metadata",
  "raw_request_body",
]);
const sensitivePayloadFragments = ["password", "secret", "vault", "token", "authorization", "service_role"];

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, string | number | boolean> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactTemplatePayload(payload: Record<string, string | number | boolean>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => {
      const normalizedKey = key.toLowerCase();
      return !sensitivePayloadKeys.has(normalizedKey) && !sensitivePayloadFragments.some((fragment) => normalizedKey.includes(fragment));
    }),
  ) as Record<string, string | number | boolean>;
}

function credentialsConfig() {
  const url = process.env.INSTAGRAM_CREDENTIALS_API_URL?.trim();
  const token = process.env.INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

function safeCredentialString(value: unknown, fallback = "") {
  return readString(value, fallback).trim();
}

function safeCredentialBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function safeCredentialsResponse(value: unknown): AddProfileCredentialsResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("credentials_invalid_response");
  }

  const row = value as SupabaseRecord;
  return {
    request_id: safeCredentialString(row.request_id),
    account_id: safeCredentialString(row.account_id),
    provider: safeCredentialString(row.provider),
    credentials_version: safeCredentialString(row.credentials_version),
    credentials_status: safeCredentialString(row.credentials_status, "unknown"),
    status: safeCredentialString(row.status, "unknown"),
    reauth_required: safeCredentialBoolean(row.reauth_required, false),
    next_action: safeCredentialString(row.next_action, "unknown"),
    password_status: "write_only",
  };
}

function isActiveCredentials(credentials: AddProfileCredentialsResponse) {
  return credentials.credentials_status === "active" && credentials.status === "active";
}

function isDuplicateAccountError(error: { code?: string; message?: string; details?: string } | null) {
  const combined = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return combined.includes("23505") || combined.includes("ig_accounts_username_lower_unique");
}

async function callSubmitAddProfileCredentials(input: AddProfileCredentialsInput) {
  const config = credentialsConfig();
  if (!config) {
    throw new Error("credentials_api_not_configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), credentialsTimeoutMs);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "submit_add_profile_credentials",
        account_id: input.accountId,
        expected_username: input.expectedUsername,
        password: input.password,
        actor_type: input.actorType,
        metadata_safe: {
          flow: "add_profile",
          external_request_id: input.externalRequestId,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("credentials_ingestion_failed");
    }

    const payload = await response.json() as { ok?: unknown; data?: unknown } & SupabaseRecord;
    if (payload.ok !== true) {
      throw new Error("credentials_ingestion_failed");
    }

    return safeCredentialsResponse(payload.data ?? payload);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("credentials_ingestion_timeout");
    }
    if (error instanceof Error && error.message === "credentials_api_not_configured") {
      throw error;
    }
    if (error instanceof Error && error.message === "credentials_invalid_response") {
      throw error;
    }
    throw new Error("credentials_ingestion_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function markCredentialFailure(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  await Promise.all([
    supabase
      .from("ig_accounts")
      .update({ status: supportRequiredStatus })
      .eq("id", accountId),
    supabase
      .from("ig_account_settings")
      .update({ account_status: supportRequiredStatus, password: "" })
      .eq("account_id", accountId),
  ]);
}

async function createCredentialSupportAction(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  reason: string,
  externalRequestId: string,
) {
  await supabase.rpc("create_credential_dashboard_action", {
    p_account_id: accountId,
    p_action_type: "review_credentials",
    p_safe_client_message: "Instagram credentials need review before this profile can run.",
    p_admin_message: "Add Profile credential ingestion did not complete.",
    p_action_deep_link: "/instagram-dashboard/credentials-actions",
    p_severity: "warning",
    p_requires_client_action: false,
    p_blocking_campaign: true,
    p_actor_type: "admin",
    p_metadata_safe: {
      source: "add_profile",
      phase: "credentials_ingestion",
      reason,
      external_request_id: externalRequestId,
    },
  });
}

async function markCredentialFailureWithSupportAction(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  reason: string,
  externalRequestId: string,
) {
  await markCredentialFailure(supabase, accountId);
  try {
    await createCredentialSupportAction(supabase, accountId, reason, externalRequestId);
  } catch {
    // Status is the safety boundary; support action creation is best-effort.
  }
}

async function compensateNewProfile(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { error } = await supabase
    .from("ig_accounts")
    .delete()
    .eq("id", accountId);
  return !error;
}

async function finalizeActiveProfile(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const [accountResult, settingsResult] = await Promise.all([
    supabase
      .from("ig_accounts")
      .update({ status: activeAccountStatus })
      .eq("id", accountId),
    supabase
      .from("ig_account_settings")
      .update({ account_status: activeAccountStatus, password: "" })
      .eq("account_id", accountId),
  ]);

  return !accountResult.error && !settingsResult.error;
}

async function fetchTemplate(
  supabase: ReturnType<typeof createSupabaseClient>,
  templateMode: string,
  templateId: string,
) {
  if (templateMode === "scratch") return null;

  const query = supabase.from("ig_account_templates").select("*");
  const result = templateMode === "selected" && templateId
    ? await query.eq("id", templateId).maybeSingle<SupabaseRecord>()
    : await query.eq("is_default", true).maybeSingle<SupabaseRecord>();

  return result.data ?? null;
}

async function fetchDeviceUdid(
  supabase: ReturnType<typeof createSupabaseClient>,
  deviceId: string,
) {
  if (!isUuid(deviceId)) return "";
  const { data } = await supabase
    .from("ig_devices")
    .select("device_udid")
    .eq("id", deviceId)
    .maybeSingle<SupabaseRecord>();

  return readString(data?.device_udid, "").trim();
}

function safeCreateResponse(account: SupabaseRecord, credentials: AddProfileCredentialsResponse) {
  return {
    account: {
      id: readString(account.id, ""),
      username: readString(account.username, ""),
      display_name: readString(account.display_name, ""),
      status: readString(account.status, "active"),
    },
    settings: {
      status: "created",
      password_status: "write_only",
      device_assignment: readString(account.device_name, "pending source"),
    },
    credentials: {
      request_id: credentials.request_id,
      account_id: credentials.account_id,
      provider: credentials.provider,
      credentials_version: credentials.credentials_version,
      credentials_status: credentials.credentials_status,
      status: credentials.status,
      reauth_required: credentials.reauth_required,
      next_action: credentials.next_action,
      password_status: "write_only",
    },
    filters: { status: "created" },
    template: { status: "applied_server_side" },
  };
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<CreateProfilePayload>(request);
    if (!body) return jsonError("Invalid profile payload.", 400);

    const username = readString(body.username, "").trim();
    if (!username) return jsonError("Instagram username is required.", 400);
    const password = readString(body.password, "");
    if (!password) return jsonError("Instagram password is required for secure credential setup.", 400);
    if (!credentialsConfig()) return jsonError("credentials_api_not_configured", 500);

    const displayName = readString(body.display_name, "").trim();
    const deviceId = readString(body.device_id, "").trim();
    const deviceName = readString(body.device_name, "Local Android Emulator").trim();
    const cloneMode = readString(body.clone_mode, "off").trim();
    const loginMethod = readString(body.login_method, "manual").trim();
    const templateMode = readString(body.template_mode, "default").trim();
    const templateId = readString(body.template_id, "").trim();
    const externalRequestId = crypto.randomUUID();
    const supabase = createSupabaseClient();
    const template = await fetchTemplate(supabase, templateMode, templateId);
    const deviceUdid = await fetchDeviceUdid(supabase, deviceId);
    const settingsPayload = isRecord(template?.settings_payload) ? redactTemplatePayload(template.settings_payload) : {};
    const filtersPayload = isRecord(template?.filters_payload) ? redactTemplatePayload(template.filters_payload) : {};

    const accountPayload = {
      username,
      display_name: displayName,
      status: supportRequiredStatus,
      device_id: isUuid(deviceId) ? deviceId : null,
      device_name: deviceName,
      device_udid: deviceUdid,
      clone_mode: cloneMode,
      login_method: loginMethod,
      internal_label: readString(body.internal_label, "").trim() || null,
      notes: readString(body.notes, "").trim() || null,
    };

    const { data: account, error: accountError } = await supabase
      .from("ig_accounts")
      .insert(accountPayload)
      .select("*")
      .single<SupabaseRecord>();

    if (accountError) {
      if (isDuplicateAccountError(accountError)) return jsonError("account_already_exists", 409);
      return jsonError("account_create_failed", 500);
    }

    const accountId = readString(account.id, "");
    const settings = {
      ...defaultInstagramSettings,
      ...settingsPayload,
      account_id: accountId,
      username,
      display_name: displayName,
      device_name: deviceName,
      device_udid: deviceUdid,
      email: readString(body.email, "").trim(),
      password: "",
      account_status: supportRequiredStatus,
      cloned_app_mode: cloneMode !== "off",
      dry_run_enabled: true,
    };
    const filters = {
      ...defaultInstagramFilters,
      ...filtersPayload,
      account_id: accountId,
    };

    const settingsResult = await supabase
      .from("ig_account_settings")
      .insert(settings)
      .select("*")
      .single<SupabaseRecord>();

    if (settingsResult.error) {
      await compensateNewProfile(supabase, accountId);
      return jsonError("profile_setup_failed", 500);
    }

    const filtersResult = await supabase
      .from("ig_account_filters")
      .insert(filters)
      .select("*")
      .single<SupabaseRecord>();

    if (filtersResult.error) {
      await compensateNewProfile(supabase, accountId);
      return jsonError("profile_setup_failed", 500);
    }

    try {
      const credentials = await callSubmitAddProfileCredentials({
        accountId,
        expectedUsername: username,
        password,
        actorType: "admin",
        externalRequestId,
      });

      if (!isActiveCredentials(credentials)) {
        await markCredentialFailureWithSupportAction(supabase, accountId, "credentials_not_active", externalRequestId);
        return jsonError("credentials_ingestion_failed", 502);
      }

      const finalized = await finalizeActiveProfile(supabase, accountId);
      if (!finalized) {
        await markCredentialFailureWithSupportAction(supabase, accountId, "profile_status_finalize_failed", externalRequestId);
        return jsonError("profile_status_finalize_failed", 502);
      }

      return jsonOk(safeCreateResponse({ ...account, status: activeAccountStatus }, credentials), 201);
    } catch (credentialsError) {
      const reason = credentialsError instanceof Error && credentialsError.message === "credentials_ingestion_timeout"
        ? "credentials_ingestion_timeout"
        : "credentials_ingestion_failed";
      await markCredentialFailureWithSupportAction(supabase, accountId, reason, externalRequestId);
      return jsonError(reason, 502);
    }
  } catch {
    return jsonError("Could not create profile.", 500);
  }
}
