import { createSupabaseClient } from "@/lib/supabase";

type SupabaseRecord = Record<string, unknown>;
type SupabaseClient = ReturnType<typeof createSupabaseClient>;

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export async function fetchActiveDmTemplate(
  supabase: SupabaseClient,
  accountId: string,
  templateType: "welcome" | "outreach",
  templateId: unknown,
) {
  const configuredTemplateId = readString(templateId, "").trim();
  let query = supabase
    .from("ig_dm_templates")
    .select("id,body,active,is_default")
    .eq("account_id", accountId)
    .eq("template_type", templateType)
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1);

  if (configuredTemplateId) {
    query = query.eq("id", configuredTemplateId);
  }

  const { data, error } = await query.maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return data;
}

export function dmTemplateHasBody(body: unknown) {
  return readString(body, "").trim().length > 0;
}

export function dmTemplateStatusLabel(body: unknown) {
  return dmTemplateHasBody(body) ? "Ready" : "Missing";
}
