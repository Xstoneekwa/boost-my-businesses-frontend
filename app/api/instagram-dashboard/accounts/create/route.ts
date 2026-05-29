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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, string | number | boolean> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function safeCreateResponse(account: SupabaseRecord) {
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
    const settingsPayload = isRecord(template?.settings_payload) ? template.settings_payload : {};
    const filtersPayload = isRecord(template?.filters_payload) ? template.filters_payload : {};

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
      password: readString(body.password, ""),
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

    return jsonOk(safeCreateResponse(account), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create profile.";
    return jsonError(message, 500);
  }
}
