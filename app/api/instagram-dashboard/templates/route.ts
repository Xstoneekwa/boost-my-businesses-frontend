import { createSupabaseClient } from "@/lib/supabase";
import { defaultSafeSetupTemplate } from "@/lib/instagram-dashboard/defaults";
import { jsonError, jsonOk, readBoolean, readJsonBody, readString, requireInstagramAdmin, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

type TemplatePayload = {
  name?: unknown;
  description?: unknown;
  template_type?: unknown;
  settings_payload?: unknown;
  filters_payload?: unknown;
  is_default?: unknown;
};

const templateTypes = new Set(["settings", "filters", "full"]);
const sensitivePayloadKeys = new Set(["password", "email", "device_udid", "app_package", "secret_ref", "vault_id", "token", "authorization", "service_role"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeTemplate(row: SupabaseRecord) {
  return {
    id: readString(row.id, ""),
    name: readString(row.name, "Untitled template"),
    description: readString(row.description, ""),
    template_type: readString(row.template_type, "full"),
    is_default: readBoolean(row.is_default, false),
    created_at: readString(row.created_at, ""),
    updated_at: readString(row.updated_at, ""),
    payload_status: "redacted",
  };
}

function redactPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !sensitivePayloadKeys.has(key.toLowerCase())),
  );
}

async function ensureDefaultTemplate(supabase: ReturnType<typeof createSupabaseClient>) {
  const { data, error } = await supabase
    .from("ig_account_templates")
    .select("*")
    .eq("is_default", true)
    .maybeSingle<SupabaseRecord>();

  if (error) return { data: null, error };
  if (data) return { data, error: null };

  return supabase
    .from("ig_account_templates")
    .insert(defaultSafeSetupTemplate)
    .select("*")
    .single<SupabaseRecord>();
}

export async function GET() {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const defaultResult = await ensureDefaultTemplate(supabase);
    if (defaultResult.error) {
      return jsonError(`${defaultResult.error.message} Apply lib/instagram-dashboard/ig-account-templates-devices.sql migration.`, 500);
    }

    const { data, error } = await supabase
      .from("ig_account_templates")
      .select("*")
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) {
      return jsonError(`${error.message} Apply lib/instagram-dashboard/ig-account-templates-devices.sql migration.`, 500);
    }

    return jsonOk((data ?? []).map(safeTemplate));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load account templates.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<TemplatePayload>(request);
    if (!body) return jsonError("Invalid template payload.", 400);

    const name = readString(body.name, "").trim();
    const description = readString(body.description, "").trim();
    const templateType = readString(body.template_type, "full").trim();

    if (!name) return jsonError("Template name is required.", 400);
    if (!templateTypes.has(templateType)) return jsonError("Invalid template type.", 400);

    const payload = {
      name,
      description: description || null,
      template_type: templateType,
      settings_payload: redactPayload(body.settings_payload),
      filters_payload: redactPayload(body.filters_payload),
      is_default: readBoolean(body.is_default, false),
      updated_at: new Date().toISOString(),
    };

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_account_templates")
      .insert(payload)
      .select("*")
      .single<SupabaseRecord>();

    if (error) {
      return jsonError(`${error.message} Apply lib/instagram-dashboard/ig-account-templates-devices.sql migration.`, 500);
    }

    return jsonOk(safeTemplate(data), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save account template.";
    return jsonError(message, 500);
  }
}
