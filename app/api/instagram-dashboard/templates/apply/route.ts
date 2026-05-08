import { createSupabaseClient } from "@/lib/supabase";
import { defaultInstagramFilters, defaultInstagramSettings } from "@/lib/instagram-dashboard/defaults";
import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, type SupabaseRecord } from "../../_utils";

export const dynamic = "force-dynamic";

type ApplyTemplatePayload = {
  account_id?: unknown;
  template_id?: unknown;
};

function isRecord(value: unknown): value is Record<string, string | number | boolean> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function upsertAccountSettings(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  payload: Record<string, string | number | boolean>,
) {
  const settings = {
    ...defaultInstagramSettings,
    ...payload,
    account_id: accountId,
    updated_at: new Date().toISOString(),
  };

  return supabase
    .from("ig_account_settings")
    .upsert(settings, { onConflict: "account_id" })
    .select("*")
    .single<SupabaseRecord>();
}

async function upsertAccountFilters(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  payload: Record<string, string | number | boolean>,
) {
  const filters = {
    ...defaultInstagramFilters,
    ...payload,
    account_id: accountId,
    updated_at: new Date().toISOString(),
  };

  return supabase
    .from("ig_account_filters")
    .upsert(filters, { onConflict: "account_id" })
    .select("*")
    .single<SupabaseRecord>();
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<ApplyTemplatePayload>(request);
    const accountId = readString(body?.account_id, "").trim();
    const templateId = readString(body?.template_id, "").trim();

    if (!accountId) return jsonError("Missing account_id.", 400);
    if (!templateId) return jsonError("Missing template_id.", 400);

    const supabase = createSupabaseClient();
    const { data: template, error: templateError } = await supabase
      .from("ig_account_templates")
      .select("*")
      .eq("id", templateId)
      .maybeSingle<SupabaseRecord>();

    if (templateError) return jsonError(templateError.message, 500);
    if (!template) return jsonError("Template not found.", 404);

    const templateType = readString(template.template_type, "full");
    const settingsPayload = isRecord(template.settings_payload) ? template.settings_payload : {};
    const filtersPayload = isRecord(template.filters_payload) ? template.filters_payload : {};
    const result: Record<string, unknown> = { template };

    if ((templateType === "settings" || templateType === "full") && Object.keys(settingsPayload).length) {
      const { data, error } = await upsertAccountSettings(supabase, accountId, settingsPayload);
      if (error) return jsonError(error.message, 500);
      result.settings = data;
    }

    if ((templateType === "filters" || templateType === "full") && Object.keys(filtersPayload).length) {
      const { data, error } = await upsertAccountFilters(supabase, accountId, filtersPayload);
      if (error) return jsonError(error.message, 500);
      result.filters = data;
    }

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not apply account template.";
    return jsonError(message, 500);
  }
}
