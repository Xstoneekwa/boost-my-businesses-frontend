import {
  CLIENT_EMAIL_CATEGORY_LABELS,
  CLIENT_EMAIL_DELIVERY_STATUSES,
  CLIENT_EMAIL_INTENT_KINDS,
  CLIENT_EMAIL_LOCKED_FROM,
  CLIENT_EMAIL_SEND_TRIGGERS,
  CLIENT_EMAIL_TEMPLATE_CATEGORIES,
  CLIENT_EMAIL_TEST_DELIVERY_LABEL,
  type ClientEmailDeliveryStatus,
  type ClientEmailIntentKind,
  type ClientEmailIntentStatus,
  type ClientEmailSendTrigger,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import {
  CLIENT_EMAIL_DELIVERY_EVENTS_TABLE,
  CLIENT_EMAIL_SEND_INTENTS_TABLE,
  probeClientEmailInfrastructure,
  probeClientEmailTestIntentSchema,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import {
  normalizeClientEmailFilter,
  type NormalizedClientEmailFilter,
} from "./client-email-filter.ts";
import { maskEmailForDisplay } from "./client-email-test-config.ts";

export { normalizeClientEmailFilter, type NormalizedClientEmailFilter } from "./client-email-filter.ts";

type SupabaseRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

export type ClientEmailHistoryFilters = {
  period?: "7d" | "30d" | "90d" | "custom";
  from?: string;
  to?: string;
  clientEmail?: string;
  category?: ClientEmailTemplateCategory;
  trigger?: ClientEmailSendTrigger;
  deliveryStatus?: ClientEmailDeliveryStatus | ClientEmailIntentStatus;
  page?: number;
  pageSize?: number;
};

export type ClientEmailHistoryListItem = {
  id: string;
  createdAt: string;
  clientName: string | null;
  instagramUsername: string | null;
  category: ClientEmailTemplateCategory;
  categoryLabel: string;
  recipientEmail: string;
  fromEmail: typeof CLIENT_EMAIL_LOCKED_FROM;
  trigger: ClientEmailSendTrigger;
  reminderIndex: number | null;
  intentStatus: ClientEmailIntentStatus;
  deliveryStatus: ClientEmailDeliveryStatus | null;
  templateVersion: number | null;
  intentKind: ClientEmailIntentKind;
  isTestDelivery: boolean;
  deliveryBadgeLabel: string | null;
};

export type ClientEmailHistoryProjection = {
  featureAvailable: boolean;
  fromEmail: typeof CLIENT_EMAIL_LOCKED_FROM;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  items: ClientEmailHistoryListItem[];
};

export type ClientEmailHistoryDetail = ClientEmailHistoryListItem & {
  scheduledFor: string | null;
  sentAt: string | null;
  resolvedAt: string | null;
  snapshotSubject: string;
  snapshotBodyText: string;
  snapshotBodyHtml: string;
  sourceNotificationId: string | null;
  sourceActionId: string | null;
  providerMessageId: string | null;
  lastErrorRedacted: string | null;
  timeline: Array<{
    status: ClientEmailDeliveryStatus;
    occurredAt: string;
    provider: string | null;
    providerMessageId: string | null;
    lastErrorRedacted: string | null;
  }>;
};

function readCategory(value: unknown): ClientEmailTemplateCategory | null {
  const normalized = readString(value, "").trim();
  return CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(normalized as ClientEmailTemplateCategory)
    ? normalized as ClientEmailTemplateCategory
    : null;
}

function readTrigger(value: unknown): ClientEmailSendTrigger | null {
  const normalized = readString(value, "").trim();
  return CLIENT_EMAIL_SEND_TRIGGERS.includes(normalized as ClientEmailSendTrigger)
    ? normalized as ClientEmailSendTrigger
    : null;
}

function readDeliveryStatus(value: unknown): ClientEmailDeliveryStatus | null {
  const normalized = readString(value, "").trim();
  return CLIENT_EMAIL_DELIVERY_STATUSES.includes(normalized as ClientEmailDeliveryStatus)
    ? normalized as ClientEmailDeliveryStatus
    : null;
}

function resolvePeriodBounds(filters: ClientEmailHistoryFilters, now = new Date()) {
  const to = filters.to ? new Date(filters.to) : now;
  const period = filters.period ?? "30d";
  if (filters.from) {
    return { from: new Date(filters.from), to };
  }
  const from = new Date(to);
  if (period === "7d") from.setDate(from.getDate() - 7);
  else if (period === "90d") from.setDate(from.getDate() - 90);
  else from.setDate(from.getDate() - 30);
  return { from, to };
}

function readIntentKind(value: unknown): ClientEmailIntentKind {
  const normalized = readString(value, "").trim();
  return CLIENT_EMAIL_INTENT_KINDS.includes(normalized as ClientEmailIntentKind)
    ? normalized as ClientEmailIntentKind
    : "client";
}

function formatRecipientEmailForRelay(email: string, isTestDelivery: boolean) {
  const normalized = email.trim();
  if (!normalized) return "—";
  if (isTestDelivery) return maskEmailForDisplay(normalized) ?? "—";
  return normalized;
}

function projectListItem(
  row: SupabaseRecord,
  context: {
    clientName?: string | null;
    instagramUsername?: string | null;
    deliveryStatus?: ClientEmailDeliveryStatus | null;
    testSchemaReady?: boolean;
  },
): ClientEmailHistoryListItem {
  const category = readCategory(row.category) ?? "needs_assistance";
  const intentKind = context.testSchemaReady ? readIntentKind(row.intent_kind) : "client";
  const isTestDelivery = intentKind === "test";
  return {
    id: readString(row.id, ""),
    createdAt: readString(row.created_at, ""),
    clientName: isTestDelivery ? null : (context.clientName ?? null),
    instagramUsername: isTestDelivery ? null : (context.instagramUsername ?? null),
    category,
    categoryLabel: CLIENT_EMAIL_CATEGORY_LABELS[category],
    recipientEmail: formatRecipientEmailForRelay(readString(row.recipient_email, ""), isTestDelivery),
    fromEmail: CLIENT_EMAIL_LOCKED_FROM,
    trigger: readTrigger(row.trigger) ?? "automatic",
    reminderIndex: typeof row.reminder_index === "number" ? row.reminder_index : null,
    intentStatus: readString(row.status, "pending") as ClientEmailIntentStatus,
    deliveryStatus: context.deliveryStatus ?? null,
    templateVersion: typeof row.template_version === "number" ? row.template_version : null,
    intentKind,
    isTestDelivery,
    deliveryBadgeLabel: isTestDelivery ? CLIENT_EMAIL_TEST_DELIVERY_LABEL : null,
  };
}

function applyClientEmailFilter<T extends { ilike: (column: string, value: string) => T }>(
  query: T,
  clientEmailFilter: NormalizedClientEmailFilter | null,
): T {
  if (!clientEmailFilter) return query;
  if (clientEmailFilter.mode === "exact") {
    return query.ilike("recipient_email", clientEmailFilter.value);
  }
  return query.ilike("recipient_email", `%${clientEmailFilter.value}%`);
}

export async function loadClientEmailHistoryProjection(
  supabase: ClientEmailSupabase,
  filters: ClientEmailHistoryFilters = {},
): Promise<ClientEmailHistoryProjection> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);

  const infrastructure = await probeClientEmailInfrastructure(supabase);
  if (!infrastructure.available) {
    return {
      featureAvailable: false,
      fromEmail: CLIENT_EMAIL_LOCKED_FROM,
      page,
      pageSize,
      totalCount: 0,
      totalPages: 0,
      items: [],
    };
  }

  const testSchema = await probeClientEmailTestIntentSchema(supabase);

  const { from, to } = resolvePeriodBounds(filters);
  const clientEmailFilter = filters.clientEmail
    ? normalizeClientEmailFilter(filters.clientEmail)
    : null;
  if (filters.clientEmail && !clientEmailFilter) {
    return {
      featureAvailable: true,
      fromEmail: CLIENT_EMAIL_LOCKED_FROM,
      page,
      pageSize,
      totalCount: 0,
      totalPages: 0,
      items: [],
    };
  }

  let query = supabase
    .from(CLIENT_EMAIL_SEND_INTENTS_TABLE)
    .select("*", { count: "exact" })
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false });

  query = applyClientEmailFilter(query, clientEmailFilter);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.trigger) query = query.eq("trigger", filters.trigger);
  if (filters.deliveryStatus) {
    const intentStatuses = new Set(["pending", "scheduled", "sent", "canceled", "failed"]);
    if (intentStatuses.has(filters.deliveryStatus)) {
      query = query.eq("status", filters.deliveryStatus);
    }
  }

  const fromIndex = (page - 1) * pageSize;
  const { data, error, count } = await query.range(fromIndex, fromIndex + pageSize - 1);
  if (error) throw new Error(error.message);

  const rows = (data as SupabaseRecord[] | null) ?? [];
  const accountIds = [...new Set(rows.map((row) => readString(row.account_id, "")).filter(Boolean))];
  const clientIds = [...new Set(rows.map((row) => readString(row.client_id, "")).filter(Boolean))];

  const accountNames = new Map<string, string>();
  if (accountIds.length > 0) {
    const { data: accounts } = await supabase
      .from("ig_accounts")
      .select("id,username")
      .in("id", accountIds);
    for (const account of (accounts as SupabaseRecord[] | null) ?? []) {
      accountNames.set(readString(account.id, ""), readString(account.username, ""));
    }
  }

  const clientNames = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id,name")
      .in("id", clientIds);
    for (const client of (clients as SupabaseRecord[] | null) ?? []) {
      clientNames.set(readString(client.id, ""), readString(client.name, ""));
    }
  }

  const intentIds = rows.map((row) => readString(row.id, "")).filter(Boolean);
  const latestDeliveryByIntent = new Map<string, ClientEmailDeliveryStatus>();
  if (intentIds.length > 0) {
    const { data: events } = await supabase
      .from(CLIENT_EMAIL_DELIVERY_EVENTS_TABLE)
      .select("intent_id,status,occurred_at")
      .in("intent_id", intentIds)
      .order("occurred_at", { ascending: false });
    for (const event of (events as SupabaseRecord[] | null) ?? []) {
      const intentId = readString(event.intent_id, "");
      if (!intentId || latestDeliveryByIntent.has(intentId)) continue;
      const status = readDeliveryStatus(event.status);
      if (status) latestDeliveryByIntent.set(intentId, status);
    }
  }

  const totalCount = count ?? 0;
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);

  return {
    featureAvailable: true,
    fromEmail: CLIENT_EMAIL_LOCKED_FROM,
    page,
    pageSize,
    totalCount,
    totalPages,
    items: rows.map((row) => projectListItem(row, {
      clientName: clientNames.get(readString(row.client_id, "")) ?? null,
      instagramUsername: accountNames.get(readString(row.account_id, "")) ?? null,
      deliveryStatus: latestDeliveryByIntent.get(readString(row.id, "")) ?? null,
      testSchemaReady: testSchema.available,
    })),
  };
}

export async function loadClientEmailHistoryDetail(
  supabase: ClientEmailSupabase,
  intentId: string,
): Promise<{ ok: true; detail: ClientEmailHistoryDetail } | { ok: false; reason: "feature_unavailable" | "not_found" }> {
  const infrastructure = await probeClientEmailInfrastructure(supabase);
  if (!infrastructure.available) return { ok: false, reason: "feature_unavailable" };

  const testSchema = await probeClientEmailTestIntentSchema(supabase);

  const normalizedId = intentId.trim();
  if (!normalizedId) return { ok: false, reason: "not_found" };

  const { data, error } = await supabase
    .from(CLIENT_EMAIL_SEND_INTENTS_TABLE)
    .select("*")
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "not_found" };

  const row = data as SupabaseRecord;
  const accountId = readString(row.account_id, "");
  const clientId = readString(row.client_id, "");
  const intentKind = testSchema.available ? readIntentKind(row.intent_kind) : "client";
  const isTestDelivery = intentKind === "test";

  let instagramUsername: string | null = null;
  let clientName: string | null = null;

  if (!isTestDelivery && accountId) {
    const { data: account } = await supabase.from("ig_accounts").select("username").eq("id", accountId).maybeSingle();
    instagramUsername = readString((account as SupabaseRecord | null)?.username, "") || null;
  }
  if (!isTestDelivery && clientId) {
    const { data: client } = await supabase.from("clients").select("name").eq("id", clientId).maybeSingle();
    clientName = readString((client as SupabaseRecord | null)?.name, "") || null;
  }

  const { data: events, error: eventsError } = await supabase
    .from(CLIENT_EMAIL_DELIVERY_EVENTS_TABLE)
    .select("status,occurred_at,provider,provider_message_id,last_error_redacted")
    .eq("intent_id", normalizedId)
    .order("occurred_at", { ascending: true });

  if (eventsError) throw new Error(eventsError.message);

  const timeline = ((events as SupabaseRecord[] | null) ?? []).map((event) => ({
    status: readDeliveryStatus(event.status) ?? "queued",
    occurredAt: readString(event.occurred_at, ""),
    provider: readString(event.provider, "") || null,
    providerMessageId: readString(event.provider_message_id, "") || null,
    lastErrorRedacted: readString(event.last_error_redacted, "") || null,
  }));

  const latestEvent = timeline[timeline.length - 1] ?? null;
  const base = projectListItem(row, {
    clientName,
    instagramUsername,
    deliveryStatus: latestEvent?.status ?? null,
    testSchemaReady: testSchema.available,
  });

  const intentProviderMessageId = readString(row.provider_message_id, "") || null;
  const intentLastError = readString(row.last_error_redacted, "") || null;

  return {
    ok: true,
    detail: {
      ...base,
      scheduledFor: readString(row.scheduled_for, "") || null,
      sentAt: readString(row.sent_at, "") || null,
      resolvedAt: readString(row.resolved_at, "") || null,
      snapshotSubject: readString(row.snapshot_subject, ""),
      snapshotBodyText: readString(row.snapshot_body_text, ""),
      snapshotBodyHtml: readString(row.snapshot_body_html, ""),
      sourceNotificationId: isTestDelivery ? null : (readString(row.source_notification_id, "") || null),
      sourceActionId: isTestDelivery ? null : (readString(row.source_action_id, "") || null),
      providerMessageId: intentProviderMessageId ?? latestEvent?.providerMessageId ?? null,
      lastErrorRedacted: intentLastError ?? latestEvent?.lastErrorRedacted ?? null,
      timeline,
    },
  };
}
