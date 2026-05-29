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
  await supabase
    .from("ig_accounts")
    .update({ status: "support_required" })
    .eq("id", accountId);
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
    const supabase = createSupabaseClient();
    const template = await fetchTemplate(supabase, templateMode, templateId);
    const deviceUdid = await fetchDeviceUdid(supabase, deviceId);
    const settingsPayload = isRecord(template?.settings_payload) ? redactTemplatePayload(template.settings_payload) : {};
    const filtersPayload = isRecord(template?.filters_payload) ? redactTemplatePayload(template.filters_payload) : {};

    const accountPayload = {
      username,
      display_name: displayName,
      status: "active",
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
      return jsonError(`${accountError.message} Apply lib/instagram-dashboard/ig-account-templates-devices.sql migration.`, 500);
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
      cloned_app_mode: cloneMode !== "off",
      dry_run_enabled: true,
    };
    const filters = {
      ...defaultInstagramFilters,
      ...filtersPayload,
      account_id: accountId,
    };

    const [settingsResult, filtersResult] = await Promise.all([
      supabase.from("ig_account_settings").insert(settings).select("*").single<SupabaseRecord>(),
      supabase.from("ig_account_filters").insert(filters).select("*").single<SupabaseRecord>(),
    ]);

    if (settingsResult.error) return jsonError(settingsResult.error.message, 500);
    if (filtersResult.error) return jsonError(filtersResult.error.message, 500);

    try {
      const credentials = await callSubmitAddProfileCredentials({
        accountId,
        expectedUsername: username,
        password,
        actorType: "admin",
        externalRequestId: crypto.randomUUID(),
      });

      return jsonOk(safeCreateResponse(account, credentials), 201);
    } catch (credentialsError) {
      await markCredentialFailure(supabase, accountId);
      const message = credentialsError instanceof Error ? credentialsError.message : "credentials_ingestion_failed";
      return jsonError(message, 502);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create profile.";
    return jsonError(message, 500);
  }
}
