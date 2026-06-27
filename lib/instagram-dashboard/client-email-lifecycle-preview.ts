import { CLIENT_EMAIL_CATEGORY_LABELS } from "./client-email-constants.ts";
import { maskEmailForDisplay } from "./client-email-test-config.ts";
import {
  projectClientContactEmailDisplay,
  resolveClientCommunicationEmail,
} from "./client-communication-email.ts";
import {
  CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES,
  CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE,
  CLIENT_EMAIL_LIFECYCLE_START_AUDIT_MESSAGES,
  type ClientEmailLifecycleDeliveryState,
  type ClientEmailLifecycleEpisodeCategory,
  type ClientEmailLifecycleEpisodeStatus,
  type ClientEmailLifecyclePreviewDecision,
  type ClientEmailLifecycleTransitionEvidence,
  isLifecycleCategoryStateActive,
  lifecycleCategoryCanonicalSource,
  mapAuditMessageToLifecycleCategory,
  planClientEmailLifecyclePreview,
  readClientEmailLifecycleAutomationEnabledAt,
} from "./client-email-lifecycle-contract.ts";
import {
  isClientEmailInfrastructureTableMissingError,
  readErrorMessage,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

type SupabaseRecord = Record<string, unknown>;

export type ClientEmailLifecyclePreviewRow = {
  instagramUsername: string | null;
  clientLabel: string | null;
  clientEmailMasked: string | null;
  category: ClientEmailLifecycleEpisodeCategory;
  categoryLabel: string;
  currentStateActive: boolean;
  canonicalSource: string;
  transitionAt: string | null;
  episodeState: "none" | ClientEmailLifecycleEpisodeStatus;
  lifecycleDecision: ClientEmailLifecyclePreviewDecision;
  deliveryState: ClientEmailLifecycleDeliveryState;
  reason: string;
};

export type ClientEmailLifecyclePreviewSummary = {
  accountsAnalyzed: number;
  pausedRows: number;
  canceledRows: number;
  needsAssistanceRows: number;
  wouldOpenOnFutureTransition: number;
  activeEpisodes: number;
  legacyStatesNoBackfill: number;
  blockedMissingClientEmail: number;
  blockedMissingTransitionEvidence: number;
};

export type ClientEmailLifecyclePreview = {
  previewedAt: string;
  readOnly: true;
  mutationExecuted: false;
  lifecycleSchemaReady: boolean;
  automationWatermarkConfigured: boolean;
  accountsAnalyzed: number;
  summary: ClientEmailLifecyclePreviewSummary;
  items: ClientEmailLifecyclePreviewRow[];
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function isLifecycleEpisodeSchemaMissingError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  if (!message.includes(CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE)) return false;
  return message.includes("schema cache")
    || message.includes("does not exist")
    || message.includes("PGRST205")
    || message.includes("42703");
}

export async function probeLifecycleEpisodeSchema(
  supabase: ClientEmailSupabase,
): Promise<{ available: true } | { available: false }> {
  const { error } = await supabase
    .from(CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE)
    .select("id,category,status")
    .limit(1);
  if (!error) return { available: true };
  if (isLifecycleEpisodeSchemaMissingError(error)) return { available: false };
  if (isClientEmailInfrastructureTableMissingError(error)) return { available: false };
  throw new Error(readErrorMessage(error));
}

export function projectLifecycleEpisodeRecord(row: SupabaseRecord) {
  return {
    accountId: readString(row.account_id, ""),
    category: readString(row.category, "") as ClientEmailLifecycleEpisodeCategory,
    status: readString(row.status, "active") as ClientEmailLifecycleEpisodeStatus,
    startedAt: readString(row.started_at, ""),
  };
}

async function loadPertinentAccountIds(supabase: ClientEmailSupabase, schemaReady: boolean) {
  const accountIds = new Set<string>();

  const { data: lifecycleRows, error: lifecycleError } = await supabase
    .from("ig_accounts")
    .select("id,admin_lifecycle_status")
    .in("admin_lifecycle_status", ["paused", "cancelled", "canceled", "needs_assistance"]);
  if (lifecycleError) throw new Error(lifecycleError.message);

  for (const row of lifecycleRows ?? []) {
    const accountId = readString((row as SupabaseRecord).id, "");
    if (accountId) accountIds.add(accountId);
  }

  if (schemaReady) {
    const { data: episodeRows, error: episodeError } = await supabase
      .from(CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE)
      .select("account_id")
      .eq("status", "active");
    if (episodeError) throw new Error(episodeError.message);
    for (const row of episodeRows ?? []) {
      const accountId = readString((row as SupabaseRecord).account_id, "");
      if (accountId) accountIds.add(accountId);
    }
  }

  return {
    accountIds: [...accountIds],
    lifecycleByAccount: new Map(
      (lifecycleRows ?? []).map((row) => {
        const record = row as SupabaseRecord;
        return [readString(record.id, ""), readString(record.admin_lifecycle_status, "")];
      }),
    ),
  };
}

async function loadAccountContextById(supabase: ClientEmailSupabase, accountIds: string[]) {
  if (accountIds.length === 0) {
    return new Map<string, {
      clientId: string;
      instagramUsername: string | null;
      clientLabel: string | null;
      clientRow: SupabaseRecord | null;
    }>();
  }

  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,client_id")
    .in("account_id", accountIds);
  if (linkError) throw new Error(linkError.message);

  const clientIds = [...new Set(
    (links ?? [])
      .map((row) => readString((row as SupabaseRecord).client_id, ""))
      .filter(Boolean),
  )];

  const [{ data: accounts, error: accountError }, { data: clients, error: clientError }] = await Promise.all([
    supabase.from("ig_accounts").select("id,username").in("id", accountIds),
    clientIds.length
      ? supabase.from("clients").select("id,name,metadata").in("id", clientIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (accountError) throw new Error(accountError.message);
  if (clientError) throw new Error(clientError.message);

  const accountById = new Map(
    (accounts ?? []).map((row) => [readString((row as SupabaseRecord).id, ""), row as SupabaseRecord]),
  );
  const clientById = new Map(
    (clients ?? []).map((row) => [readString((row as SupabaseRecord).id, ""), row as SupabaseRecord]),
  );

  const out = new Map<string, {
    clientId: string;
    instagramUsername: string | null;
    clientLabel: string | null;
    clientRow: SupabaseRecord | null;
  }>();

  for (const row of links ?? []) {
    const record = row as SupabaseRecord;
    const accountId = readString(record.account_id, "");
    const clientId = readString(record.client_id, "");
    if (!accountId || !clientId) continue;
    const account = accountById.get(accountId) ?? null;
    const client = clientById.get(clientId) ?? null;
    out.set(accountId, {
      clientId,
      instagramUsername: readString(account?.username, "") || null,
      clientLabel: readString(client?.name, "") || null,
      clientRow: client,
    });
  }

  return out;
}

async function loadActiveEpisodesByAccountCategory(
  supabase: ClientEmailSupabase,
  accountIds: string[],
  schemaReady: boolean,
) {
  const out = new Map<string, { status: ClientEmailLifecycleEpisodeStatus; startedAt: string }>();
  if (!schemaReady || accountIds.length === 0) return out;

  const { data, error } = await supabase
    .from(CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE)
    .select("account_id,category,status,started_at")
    .in("account_id", accountIds)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const episode = projectLifecycleEpisodeRecord(row as SupabaseRecord);
    if (!episode.accountId || !episode.category) continue;
    out.set(`${episode.accountId}:${episode.category}`, {
      status: episode.status,
      startedAt: episode.startedAt,
    });
  }
  return out;
}

async function loadLatestTransitionEvidenceByAccountCategory(
  supabase: ClientEmailSupabase,
  accountIds: string[],
) {
  const out = new Map<string, ClientEmailLifecycleTransitionEvidence>();
  if (accountIds.length === 0) return out;

  const startMessages = CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES.map(
    (category) => CLIENT_EMAIL_LIFECYCLE_START_AUDIT_MESSAGES[category],
  );

  const { data, error } = await supabase
    .from("ig_action_logs")
    .select("account_id,message,created_at")
    .eq("action_type", "account_admin_status_changed")
    .in("account_id", accountIds)
    .in("message", startMessages)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const record = row as SupabaseRecord;
    const accountId = readString(record.account_id, "");
    const message = readString(record.message, "");
    const category = mapAuditMessageToLifecycleCategory(message);
    const occurredAt = readString(record.created_at, "");
    if (!accountId || !category || !occurredAt) continue;
    const key = `${accountId}:${category}`;
    if (!out.has(key)) {
      out.set(key, {
        message,
        occurredAt,
        source: "ig_action_logs.account_admin_status_changed",
      });
    }
  }

  return out;
}

function summarizeItems(
  items: ClientEmailLifecyclePreviewRow[],
  accountCount: number,
): ClientEmailLifecyclePreviewSummary {
  return {
    accountsAnalyzed: accountCount,
    pausedRows: items.filter((item) => item.category === "account_paused").length,
    canceledRows: items.filter((item) => item.category === "account_canceled").length,
    needsAssistanceRows: items.filter((item) => item.category === "needs_assistance").length,
    wouldOpenOnFutureTransition: items.filter((item) =>
      item.lifecycleDecision === "would_open_episode_on_future_transition").length,
    activeEpisodes: items.filter((item) => item.episodeState === "active").length,
    legacyStatesNoBackfill: items.filter((item) => item.lifecycleDecision === "legacy_state_no_backfill").length,
    blockedMissingClientEmail: items.filter((item) =>
      item.deliveryState === "blocked_missing_client_email").length,
    blockedMissingTransitionEvidence: items.filter((item) =>
      item.deliveryState === "blocked_missing_transition_evidence").length,
  };
}

export async function loadClientEmailLifecyclePreview(
  supabase: ClientEmailSupabase,
  input: { now?: Date; env?: Record<string, string | undefined> } = {},
): Promise<ClientEmailLifecyclePreview> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const automationEnabledAt = readClientEmailLifecycleAutomationEnabledAt(env);
  const schema = await probeLifecycleEpisodeSchema(supabase);
  const { accountIds, lifecycleByAccount } = await loadPertinentAccountIds(supabase, schema.available);

  if (accountIds.length === 0) {
    return {
      previewedAt: now.toISOString(),
      readOnly: true,
      mutationExecuted: false,
      lifecycleSchemaReady: schema.available,
      automationWatermarkConfigured: Boolean(automationEnabledAt),
      accountsAnalyzed: 0,
      summary: {
        accountsAnalyzed: 0,
        pausedRows: 0,
        canceledRows: 0,
        needsAssistanceRows: 0,
        wouldOpenOnFutureTransition: 0,
        activeEpisodes: 0,
        legacyStatesNoBackfill: 0,
        blockedMissingClientEmail: 0,
        blockedMissingTransitionEvidence: 0,
      },
      items: [],
    };
  }

  const [contextByAccount, episodesByKey, transitionsByKey] = await Promise.all([
    loadAccountContextById(supabase, accountIds),
    loadActiveEpisodesByAccountCategory(supabase, accountIds, schema.available),
    loadLatestTransitionEvidenceByAccountCategory(supabase, accountIds),
  ]);

  const items: ClientEmailLifecyclePreviewRow[] = [];

  for (const accountId of accountIds.sort()) {
    const context = contextByAccount.get(accountId);
    if (!context) continue;
    const adminLifecycleStatus = lifecycleByAccount.get(accountId) ?? "active";

    const resolvedEmail = resolveClientCommunicationEmail({
      client: context.clientRow,
      workspaceAuthEmail: null,
    });
    const projectedEmail = projectClientContactEmailDisplay(resolvedEmail);
    const clientEmailMasked = projectedEmail.available
      ? maskEmailForDisplay(projectedEmail.display)
      : null;

    for (const category of CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES) {
      const episode = episodesByKey.get(`${accountId}:${category}`) ?? null;
      const currentStateActive = isLifecycleCategoryStateActive(category, adminLifecycleStatus);
      if (!currentStateActive && !episode) continue;

      const transitionEvidence = transitionsByKey.get(`${accountId}:${category}`) ?? null;
      const planned = planClientEmailLifecyclePreview({
        category,
        adminLifecycleStatus,
        automationEnabledAt,
        transitionEvidence,
        activeEpisodeStatus: episode?.status ?? null,
        clientEmailAvailable: projectedEmail.available,
      });

      items.push({
        instagramUsername: context.instagramUsername,
        clientLabel: context.clientLabel,
        clientEmailMasked,
        category,
        categoryLabel: CLIENT_EMAIL_CATEGORY_LABELS[category],
        currentStateActive: planned.currentStateActive,
        canonicalSource: lifecycleCategoryCanonicalSource(category),
        transitionAt: transitionEvidence?.occurredAt ?? null,
        episodeState: episode?.status ?? "none",
        lifecycleDecision: planned.lifecycleDecision,
        deliveryState: planned.deliveryState,
        reason: planned.reason,
      });
    }
  }

  items.sort((left, right) => {
    const accountCompare = (left.instagramUsername ?? "").localeCompare(right.instagramUsername ?? "");
    if (accountCompare !== 0) return accountCompare;
    return left.category.localeCompare(right.category);
  });

  return {
    previewedAt: now.toISOString(),
    readOnly: true,
    mutationExecuted: false,
    lifecycleSchemaReady: schema.available,
    automationWatermarkConfigured: Boolean(automationEnabledAt),
    accountsAnalyzed: accountIds.length,
    summary: summarizeItems(items, accountIds.length),
    items,
  };
}
