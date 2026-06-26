import {
  CLIENT_EMAIL_LOCKED_FROM,
  CLIENT_EMAIL_TEMPLATE_CATEGORIES,
  CLIENT_EMAIL_TEST_DEMO_VALUES,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import { buildTemplatePreview } from "./client-email-template-render.ts";
import {
  CLIENT_EMAIL_SEND_INTENTS_TABLE,
  CLIENT_EMAIL_TEMPLATES_TABLE,
  probeClientEmailInfrastructure,
  probeClientEmailTestIntentSchema,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import { executePostmarkTestDeliverySend } from "./client-email-postmark-test-send.ts";
import {
  evaluateClientEmailTestSendingGate,
  projectClientEmailTestDeliveryStatus,
  rejectForbiddenTestDeliveryRecipientFields,
} from "./client-email-test-config.ts";

type SupabaseRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readCategory(value: unknown): ClientEmailTemplateCategory | null {
  const normalized = readString(value, "");
  return CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(normalized as ClientEmailTemplateCategory)
    ? normalized as ClientEmailTemplateCategory
    : null;
}

type IntentsQuery = {
  select: (columns: string) => IntentsQuery;
  eq: (column: string, value: string) => IntentsQuery;
  in: (column: string, values: string[]) => IntentsQuery;
  insert: (values: SupabaseRecord) => IntentsQuery;
  update: (values: SupabaseRecord) => IntentsQuery;
  order: (column: string, options: { ascending: boolean }) => IntentsQuery;
  limit: (count: number) => IntentsQuery;
  maybeSingle: () => Promise<{ data: SupabaseRecord | null; error: unknown }>;
};

function intentsTable(supabase: ClientEmailSupabase): IntentsQuery {
  return supabase.from(CLIENT_EMAIL_SEND_INTENTS_TABLE) as unknown as IntentsQuery;
}

export async function loadClientEmailTestDeliveryStatus(
  supabase: ClientEmailSupabase,
  env: Record<string, string | undefined> = process.env,
) {
  const infrastructure = await probeClientEmailInfrastructure(supabase);
  const testSchema = infrastructure.available
    ? await probeClientEmailTestIntentSchema(supabase)
    : { available: false as const };

  return projectClientEmailTestDeliveryStatus({
    env,
    testSchemaReady: testSchema.available,
  });
}

export type ExecuteClientEmailTestDeliveryInput = {
  category: ClientEmailTemplateCategory;
  confirmed: boolean;
};

export type ExecuteClientEmailTestDeliveryResult =
  | {
    ok: true;
    action: "sent" | "already_sent";
    intentId: string;
    providerMessageId: string | null;
  }
  | {
    ok: false;
    reason:
      | "confirmation_required"
      | "forbidden_recipient_field"
      | "invalid_category"
      | "template_not_configured"
      | "feature_unavailable"
      | "test_schema_unavailable"
      | "test_in_progress"
      | "gate_closed"
      | "provider_error";
    message: string;
  };

export async function executeClientEmailTestDelivery(
  supabase: ClientEmailSupabase,
  input: ExecuteClientEmailTestDeliveryInput,
  body: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch,
): Promise<ExecuteClientEmailTestDeliveryResult> {
  const forbiddenField = rejectForbiddenTestDeliveryRecipientFields(body);
  if (forbiddenField) {
    return { ok: false, reason: "forbidden_recipient_field", message: forbiddenField };
  }
  if (!input.confirmed) {
    return {
      ok: false,
      reason: "confirmation_required",
      message: "Explicit confirmation is required before sending a test delivery.",
    };
  }

  const category = readCategory(input.category);
  if (!category) {
    return { ok: false, reason: "invalid_category", message: "Template category is invalid." };
  }

  const infrastructure = await probeClientEmailInfrastructure(supabase);
  if (!infrastructure.available) {
    return { ok: false, reason: "feature_unavailable", message: "Email infrastructure is unavailable." };
  }

  const testSchema = await probeClientEmailTestIntentSchema(supabase);
  if (!testSchema.available) {
    return {
      ok: false,
      reason: "test_schema_unavailable",
      message: "Test intent schema migration is not applied yet.",
    };
  }

  const gate = evaluateClientEmailTestSendingGate(env);
  if (!gate.allowed) {
    return { ok: false, reason: "gate_closed", message: gate.message };
  }

  const { data: templateRow, error: templateError } = await supabase
    .from(CLIENT_EMAIL_TEMPLATES_TABLE)
    .select("id,category,version,subject,body_text,body_html,status")
    .eq("category", category)
    .eq("status", "active")
    .maybeSingle();

  if (templateError) throw new Error(readString(templateError.message, "Template lookup failed."));
  if (!templateRow) {
    return { ok: false, reason: "template_not_configured", message: "Active template is not configured for this category." };
  }

  const template = templateRow as SupabaseRecord;
  const templateId = readString(template.id, "");
  const templateVersion = Number(template.version) || 0;
  const idempotencyKey = `manual_test:${category}:${templateId}`;

  const existing = await intentsTable(supabase)
    .select("id,status,provider_message_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) throw new Error("Could not verify test delivery idempotency.");
  if (existing.data?.id) {
    return {
      ok: true,
      action: "already_sent",
      intentId: readString(existing.data.id, ""),
      providerMessageId: readString(existing.data.provider_message_id, "") || null,
    };
  }

  const inFlight = await intentsTable(supabase)
    .select("id")
    .eq("intent_kind", "test")
    .in("status", ["pending", "scheduled"])
    .limit(1)
    .maybeSingle();

  if (inFlight.error) throw new Error("Could not verify active test delivery state.");
  if (inFlight.data?.id && readString(inFlight.data.id, "") !== readString(existing.data?.id, "")) {
    return {
      ok: false,
      reason: "test_in_progress",
      message: "Another test delivery is already in progress.",
    };
  }

  const preview = buildTemplatePreview(
    readString(template.subject, ""),
    readString(template.body_text, ""),
    CLIENT_EMAIL_TEST_DEMO_VALUES,
  );

  const now = new Date().toISOString();
  const insertResult = await intentsTable(supabase)
    .insert({
      intent_kind: "test",
      category,
      client_id: null,
      account_id: null,
      recipient_email: gate.recipientEmail,
      from_email: CLIENT_EMAIL_LOCKED_FROM,
      trigger: "manual_test",
      reminder_index: null,
      template_id: templateId,
      template_version: templateVersion,
      snapshot_subject: preview.subject,
      snapshot_body_text: preview.bodyText,
      snapshot_body_html: preview.bodyHtml,
      source_notification_id: null,
      source_action_id: null,
      idempotency_key: idempotencyKey,
      status: "pending",
      created_at: now,
    })
    .select("id")
    .maybeSingle();

  if (insertResult.error) {
    const message = readString((insertResult.error as { message?: string }).message, "").toLowerCase();
    if (message.includes("duplicate") || message.includes("unique")) {
      const retry = await intentsTable(supabase)
        .select("id,status,provider_message_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (retry.data?.id) {
        return {
          ok: true,
          action: "already_sent",
          intentId: readString(retry.data.id, ""),
          providerMessageId: readString(retry.data.provider_message_id, "") || null,
        };
      }
    }
    throw new Error("Could not create test delivery intent.");
  }

  const intentId = readString(insertResult.data?.id, "");
  if (!intentId) throw new Error("Test delivery intent id missing after insert.");

  const sendResult = await executePostmarkTestDeliverySend({
    intentId,
    recipientEmail: gate.recipientEmail,
    subject: preview.subject,
    bodyText: preview.bodyText,
    bodyHtml: preview.bodyHtml,
    category,
  }, env, fetcher);

  if (!sendResult.ok) {
    await intentsTable(supabase)
      .update({
        status: "failed",
        last_error_redacted: sendResult.message,
        resolved_at: now,
      })
      .eq("id", intentId);
    return {
      ok: false,
      reason: sendResult.reason === "provider_error" ? "provider_error" : "gate_closed",
      message: sendResult.message,
    };
  }

  await intentsTable(supabase)
    .update({
      status: "sent",
      sent_at: now,
      provider_message_id: sendResult.providerMessageId,
      last_error_redacted: null,
    })
    .eq("id", intentId);

  return {
    ok: true,
    action: "sent",
    intentId,
    providerMessageId: sendResult.providerMessageId,
  };
}
