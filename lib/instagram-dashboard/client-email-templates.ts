import {
  CLIENT_EMAIL_CATEGORY_LABELS,
  CLIENT_EMAIL_LOCKED_FROM,
  CLIENT_EMAIL_TEMPLATE_CATEGORIES,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import {
  CLIENT_EMAIL_TEMPLATES_TABLE,
  probeClientEmailInfrastructure,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import {
  buildTemplatePreview,
  listAllowedVariablesForCategory,
  textToSafeHtml,
  validateTemplateVariableUsage,
} from "./client-email-template-render.ts";

type SupabaseRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

export type ClientEmailTemplateView = {
  id: string;
  category: ClientEmailTemplateCategory;
  categoryLabel: string;
  version: number;
  status: "active" | "retired";
  subject: string;
  bodyText: string;
  bodyHtml: string;
  allowedVariables: string[];
  configured: boolean;
  fromEmail: typeof CLIENT_EMAIL_LOCKED_FROM;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};

export type ClientEmailTemplatesProjection = {
  featureAvailable: boolean;
  fromEmail: typeof CLIENT_EMAIL_LOCKED_FROM;
  categories: ClientEmailTemplateCategory[];
  templates: ClientEmailTemplateView[];
};

function readCategory(value: unknown): ClientEmailTemplateCategory | null {
  const normalized = readString(value, "").trim();
  return CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(normalized as ClientEmailTemplateCategory)
    ? normalized as ClientEmailTemplateCategory
    : null;
}

function projectTemplateRow(row: SupabaseRecord, configured: boolean): ClientEmailTemplateView {
  const category = readCategory(row.category) ?? "needs_assistance";
  return {
    id: readString(row.id, ""),
    category,
    categoryLabel: CLIENT_EMAIL_CATEGORY_LABELS[category],
    version: Number(row.version) || 0,
    status: readString(row.status, "retired") === "active" ? "active" : "retired",
    subject: readString(row.subject, ""),
    bodyText: readString(row.body_text, ""),
    bodyHtml: readString(row.body_html, ""),
    allowedVariables: listAllowedVariablesForCategory(),
    configured,
    fromEmail: CLIENT_EMAIL_LOCKED_FROM,
    createdAt: readString(row.created_at, ""),
    updatedAt: readString(row.updated_at, ""),
    createdBy: readString(row.created_by, ""),
    updatedBy: readString(row.updated_by, ""),
  };
}

function buildCategoryPlaceholders(): ClientEmailTemplateView[] {
  return CLIENT_EMAIL_TEMPLATE_CATEGORIES.map((category) => ({
    id: "",
    category,
    categoryLabel: CLIENT_EMAIL_CATEGORY_LABELS[category],
    version: 0,
    status: "retired" as const,
    subject: "",
    bodyText: "",
    bodyHtml: "",
    allowedVariables: listAllowedVariablesForCategory(),
    configured: false,
    fromEmail: CLIENT_EMAIL_LOCKED_FROM,
    createdAt: "",
    updatedAt: "",
    createdBy: "",
    updatedBy: "",
  }));
}

export async function loadClientEmailTemplatesProjection(
  supabase: ClientEmailSupabase,
): Promise<ClientEmailTemplatesProjection> {
  const infrastructure = await probeClientEmailInfrastructure(supabase);
  if (!infrastructure.available) {
    return {
      featureAvailable: false,
      fromEmail: CLIENT_EMAIL_LOCKED_FROM,
      categories: [...CLIENT_EMAIL_TEMPLATE_CATEGORIES],
      templates: buildCategoryPlaceholders(),
    };
  }

  const { data, error } = await supabase
    .from(CLIENT_EMAIL_TEMPLATES_TABLE)
    .select("id,category,version,status,subject,body_text,body_html,allowed_variables,created_at,updated_at,created_by,updated_by")
    .eq("status", "active")
    .order("category", { ascending: true });

  if (error) throw new Error(error.message);

  const activeByCategory = new Map<ClientEmailTemplateCategory, ClientEmailTemplateView>();
  for (const row of (data as SupabaseRecord[] | null) ?? []) {
    const category = readCategory(row.category);
    if (!category) continue;
    activeByCategory.set(category, projectTemplateRow(row, true));
  }

  const templates = CLIENT_EMAIL_TEMPLATE_CATEGORIES.map((category) => (
    activeByCategory.get(category) ?? buildCategoryPlaceholders().find((row) => row.category === category)!
  ));

  return {
    featureAvailable: true,
    fromEmail: CLIENT_EMAIL_LOCKED_FROM,
    categories: [...CLIENT_EMAIL_TEMPLATE_CATEGORIES],
    templates,
  };
}

export type SaveClientEmailTemplateInput = {
  category: ClientEmailTemplateCategory;
  subject: string;
  bodyText: string;
  updatedBy: string;
};

export type SaveClientEmailTemplateResult =
  | { ok: true; template: ClientEmailTemplateView; createdNewVersion: boolean }
  | { ok: false; reason: "feature_unavailable" | "invalid_category" | "invalid_subject" | "invalid_body" | "unknown_variables"; unknownVariables?: string[] };

export async function saveClientEmailTemplateVersion(
  supabase: ClientEmailSupabase,
  input: SaveClientEmailTemplateInput,
): Promise<SaveClientEmailTemplateResult> {
  const infrastructure = await probeClientEmailInfrastructure(supabase);
  if (!infrastructure.available) {
    return { ok: false, reason: "feature_unavailable" };
  }

  const category = readCategory(input.category);
  if (!category) return { ok: false, reason: "invalid_category" };

  const subject = input.subject.trim();
  const bodyText = input.bodyText.trim();
  if (!subject) return { ok: false, reason: "invalid_subject" };
  if (!bodyText) return { ok: false, reason: "invalid_body" };

  const unknownVariables = validateTemplateVariableUsage(subject, bodyText);
  if (unknownVariables.length > 0) {
    return { ok: false, reason: "unknown_variables", unknownVariables };
  }

  const { data: activeRows, error: activeError } = await supabase
    .from(CLIENT_EMAIL_TEMPLATES_TABLE)
    .select("id,category,version,status,subject,body_text,body_html,allowed_variables,created_at,updated_at,created_by,updated_by")
    .eq("category", category)
    .eq("status", "active")
    .limit(1);

  if (activeError) throw new Error(activeError.message);
  const active = ((activeRows as SupabaseRecord[] | null) ?? [])[0] ?? null;

  if (
    active
    && readString(active.subject, "") === subject
    && readString(active.body_text, "") === bodyText
  ) {
    return {
      ok: true,
      template: projectTemplateRow(active, true),
      createdNewVersion: false,
    };
  }

  const { data: versionRows, error: versionError } = await supabase
    .from(CLIENT_EMAIL_TEMPLATES_TABLE)
    .select("version")
    .eq("category", category)
    .order("version", { ascending: false })
    .limit(1);

  if (versionError) throw new Error(versionError.message);
  const nextVersion = Number(((versionRows as SupabaseRecord[] | null) ?? [])[0]?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const allowedVariables = listAllowedVariablesForCategory();
  const bodyHtml = textToSafeHtml(bodyText);

  if (active) {
    const { error: retireError } = await supabase
      .from(CLIENT_EMAIL_TEMPLATES_TABLE)
      .update({ status: "retired", updated_at: now, updated_by: input.updatedBy })
      .eq("id", readString(active.id, ""))
      .eq("status", "active");
    if (retireError) throw new Error(retireError.message);
  }

  const { data: inserted, error: insertError } = await supabase
    .from(CLIENT_EMAIL_TEMPLATES_TABLE)
    .insert({
      category,
      version: nextVersion,
      status: "active",
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      allowed_variables: allowedVariables,
      created_at: now,
      created_by: input.updatedBy,
      updated_at: now,
      updated_by: input.updatedBy,
    })
    .select("id,category,version,status,subject,body_text,body_html,allowed_variables,created_at,updated_at,created_by,updated_by")
    .maybeSingle();

  if (insertError) throw new Error(insertError.message);
  if (!inserted) throw new Error("Template version could not be created.");

  return {
    ok: true,
    template: projectTemplateRow(inserted as SupabaseRecord, true),
    createdNewVersion: true,
  };
}

export function previewClientEmailTemplate(input: {
  subject: string;
  bodyText: string;
}) {
  const unknownVariables = validateTemplateVariableUsage(input.subject, input.bodyText);
  if (unknownVariables.length > 0) {
    return { ok: false as const, reason: "unknown_variables" as const, unknownVariables };
  }
  return {
    ok: true as const,
    fromEmail: CLIENT_EMAIL_LOCKED_FROM,
    preview: buildTemplatePreview(input.subject, input.bodyText),
    allowedVariables: listAllowedVariablesForCategory(),
  };
}

export function rejectForbiddenEmailTemplateFields(body: Record<string, unknown>): string | null {
  for (const field of ["from_email", "provider", "provider_api_key", "api_key", "secret", "token", "webhook_secret"]) {
    if (field in body) return `Field ${field} is not allowed.`;
  }
  return null;
}
