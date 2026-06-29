import {
  canPersistNeedsMoreTargetsEmailAutomation,
  evaluateNeedsMoreMaterializePersistGate,
} from "./client-email-needs-more-targets-automation-config.ts";
import {
  cancelPendingNeedsMoreIntentsForAccount,
  loadActiveNeedsMoreEpisodeForAccount,
  persistNeedsMoreCloseEpisode,
  persistNeedsMoreOpenEpisode,
} from "./client-email-needs-more-sequence-persist.ts";
import {
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE,
  type NeedsMoreTargetsEpisodePlan,
  type NeedsMoreTargetsSequenceRecord,
  planNeedsMoreTargetsEpisodeReconciliation,
} from "./client-email-needs-more-targets-sequence.ts";
import {
  isClientEmailInfrastructureTableMissingError,
  readErrorCode,
  readErrorMessage,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import { loadTargetEligibilityCountsByAccount } from "./account-target-eligibility.ts";
import {
  NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
  loadActiveNeedsMoreTargetAccountsAction,
  resolveNeedsMoreActiveSince,
} from "./needs-more-target-accounts.ts";

type SupabaseRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isNeedsMoreTargetsSequenceSchemaMissingError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  if (!message.includes(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)) return false;
  const code = readErrorCode(error);
  return message.includes("schema cache")
    || message.includes("does not exist")
    || code === "PGRST204"
    || code === "42703";
}

export async function probeNeedsMoreTargetsSequenceSchema(
  supabase: ClientEmailSupabase,
): Promise<{ available: true } | { available: false }> {
  const { error } = await supabase
    .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
    .select("id,status,episode_key")
    .limit(1);
  if (!error) return { available: true };
  if (isNeedsMoreTargetsSequenceSchemaMissingError(error)) return { available: false };
  if (isClientEmailInfrastructureTableMissingError(error)) return { available: false };
  throw new Error(readErrorMessage(error));
}

export function projectSequenceRecord(row: SupabaseRecord): NeedsMoreTargetsSequenceRecord {
  return {
    id: readString(row.id, ""),
    accountId: readString(row.account_id, ""),
    clientId: readString(row.client_id, ""),
    sourceActionId: readString(row.source_action_id, "") || null,
    status: readString(row.status, "active") as NeedsMoreTargetsSequenceRecord["status"],
    eligibleTargetCountAtStart: readNumber(row.eligible_target_count_at_start, 0),
    thresholdAtStart: readNumber(row.threshold_at_start, 5),
    startedAt: readString(row.started_at, ""),
    resolvedAt: readString(row.resolved_at, "") || null,
    canceledAt: readString(row.canceled_at, "") || null,
    closeReason: readString(row.close_reason, "") as NeedsMoreTargetsSequenceRecord["closeReason"] || null,
    nextReminderIndex: readNumber(row.next_reminder_index, 0),
    lastCompletedReminderIndex: typeof row.last_completed_reminder_index === "number"
      ? row.last_completed_reminder_index
      : null,
    episodeKey: readString(row.episode_key, ""),
  };
}

export class NeedsMoreTargetsSequenceMemoryStore {
  private episodes: NeedsMoreTargetsSequenceRecord[] = [];

  listActive() {
    return this.episodes.filter((episode) => episode.status === "active");
  }

  getActiveForAccount(accountId: string) {
    return this.episodes.find((episode) => episode.accountId === accountId && episode.status === "active") ?? null;
  }

  listAll() {
    return [...this.episodes];
  }

  applyPlan(plan: NeedsMoreTargetsEpisodePlan, input: {
    accountId: string;
    clientId: string;
    now: Date;
  }) {
    for (const action of plan.actions) {
      if (action.type === "open_episode") {
        const episode: NeedsMoreTargetsSequenceRecord = {
          id: `episode-${this.episodes.length + 1}`,
          accountId: input.accountId,
          clientId: input.clientId,
          sourceActionId: action.sourceActionId,
          status: "active",
          eligibleTargetCountAtStart: action.eligibleTargetCount,
          thresholdAtStart: 5,
          startedAt: action.startedAtIso,
          resolvedAt: null,
          canceledAt: null,
          closeReason: null,
          nextReminderIndex: 0,
          lastCompletedReminderIndex: null,
          episodeKey: action.episodeKey,
        };
        this.episodes.push(episode);
      }
      if (action.type === "close_episode") {
        const active = this.getActiveForAccount(plan.accountId);
        if (!active) continue;
        active.status = action.closeReason === "account_canceled" ? "canceled" : "resolved";
        active.closeReason = action.closeReason;
        active.resolvedAt = action.closeReason === "account_canceled" ? null : input.now.toISOString();
        active.canceledAt = action.closeReason === "account_canceled" ? input.now.toISOString() : null;
      }
    }
  }
}

export type NeedsMoreTargetsAccountSnapshot = {
  accountId: string;
  clientId: string;
  accountCanceled: boolean;
  eligibleTargetCount: number;
  needsMoreSignalActive: boolean;
  sourceActionId: string | null;
  needsMoreActiveSince: string | null;
};

export type ReconcileNeedsMoreTargetsEmailSequencesResult = {
  automationGateOpen: boolean;
  sequenceSchemaReady: boolean;
  persistAllowed: boolean;
  postmarkFetchCount: number;
  intentsCreated: number;
  episodesOpened: number;
  episodesClosed: number;
  plannedSends: number;
  persistedOpens: number;
  persistedCloses: number;
  intentsCanceled: number;
  plans: NeedsMoreTargetsEpisodePlan[];
  gateReason: string | null;
};

export async function loadNeedsMoreTargetsAccountSnapshot(
  supabase: ClientEmailSupabase,
  accountId: string,
  input: {
    eligibleTargetCount: number;
    accountCanceled?: boolean;
  },
): Promise<NeedsMoreTargetsAccountSnapshot | null> {
  const { data: link, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle();
  if (linkError) throw new Error(linkError.message);
  const clientId = readString((link as SupabaseRecord | null)?.client_id, "");
  if (!clientId) return null;

  const activeAction = await loadActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  return {
    accountId,
    clientId,
    accountCanceled: input.accountCanceled === true,
    eligibleTargetCount: input.eligibleTargetCount,
    needsMoreSignalActive: Boolean(activeAction?.id),
    sourceActionId: readString(activeAction?.id, "") || null,
    needsMoreActiveSince: resolveNeedsMoreActiveSince(activeAction),
  };
}

const ACTIVE_NEEDS_MORE_ACTION_STATUSES = ["pending", "acknowledged", "pending_verification"] as const;

async function loadPertinentNeedsMoreAccountIds(
  supabase: ClientEmailSupabase,
  sequenceSchemaReady: boolean,
) {
  const accountIds = new Set<string>();
  const { data: signalRows, error: signalError } = await supabase
    .from("account_dashboard_actions")
    .select("account_id")
    .eq("action_type", NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE)
    .in("status", [...ACTIVE_NEEDS_MORE_ACTION_STATUSES]);
  if (signalError) throw new Error(signalError.message);
  for (const row of signalRows ?? []) {
    const accountId = readString((row as SupabaseRecord).account_id, "");
    if (accountId) accountIds.add(accountId);
  }

  if (sequenceSchemaReady) {
    const { data: episodeRows, error: episodeError } = await supabase
      .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
      .select("account_id")
      .eq("status", "active");
    if (episodeError) throw new Error(episodeError.message);
    for (const row of episodeRows ?? []) {
      const accountId = readString((row as SupabaseRecord).account_id, "");
      if (accountId) accountIds.add(accountId);
    }
  }

  return [...accountIds];
}

export async function loadAllNeedsMoreTargetsReconcileSnapshots(
  supabase: ClientEmailSupabase,
): Promise<NeedsMoreTargetsAccountSnapshot[]> {
  const schema = await probeNeedsMoreTargetsSequenceSchema(supabase);
  const accountIds = await loadPertinentNeedsMoreAccountIds(supabase, schema.available);
  if (accountIds.length === 0) return [];

  const [{ data: links, error: linkError }, eligibilityByAccount] = await Promise.all([
    supabase
      .from("client_instagram_accounts")
      .select("account_id,client_id")
      .in("account_id", accountIds),
    loadTargetEligibilityCountsByAccount(supabase, accountIds),
  ]);
  if (linkError) throw new Error(linkError.message);

  const { data: accounts, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,admin_lifecycle_status")
    .in("id", accountIds);
  if (accountError) throw new Error(accountError.message);

  const accountStatusById = new Map(
    (accounts ?? []).map((row) => [
      readString((row as SupabaseRecord).id, ""),
      readString((row as SupabaseRecord).admin_lifecycle_status, ""),
    ]),
  );

  const snapshots: NeedsMoreTargetsAccountSnapshot[] = [];
  for (const row of links ?? []) {
    const record = row as SupabaseRecord;
    const accountId = readString(record.account_id, "");
    const clientId = readString(record.client_id, "");
    if (!accountId || !clientId) continue;

    const adminStatus = accountStatusById.get(accountId) ?? "";
    const normalizedStatus = adminStatus.trim().toLowerCase();
    const accountCanceled = normalizedStatus === "cancelled" || normalizedStatus === "canceled";
    const eligibleTargetCount = eligibilityByAccount.get(accountId)?.eligible ?? 0;
    const snapshot = await loadNeedsMoreTargetsAccountSnapshot(supabase, accountId, {
      eligibleTargetCount,
      accountCanceled,
    });
    if (snapshot) snapshots.push(snapshot);
  }

  return snapshots;
}

export async function reconcileNeedsMoreTargetAccountEmailSequences(
  supabase: ClientEmailSupabase,
  input: {
    snapshots: NeedsMoreTargetsAccountSnapshot[];
    now?: Date;
    env?: Record<string, string | undefined>;
    memoryStore?: NeedsMoreTargetsSequenceMemoryStore;
    fetcher?: typeof fetch;
  },
): Promise<ReconcileNeedsMoreTargetsEmailSequencesResult> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const gate = evaluateNeedsMoreMaterializePersistGate(env);
  const schema = await probeNeedsMoreTargetsSequenceSchema(supabase);
  const persistAllowed = gate.allowed && schema.available && canPersistNeedsMoreTargetsEmailAutomation(env);
  const store = input.memoryStore;

  const plans: NeedsMoreTargetsEpisodePlan[] = [];
  let episodesOpened = 0;
  let episodesClosed = 0;
  let plannedSends = 0;
  let persistedOpens = 0;
  let persistedCloses = 0;
  let intentsCanceled = 0;

  for (const snapshot of input.snapshots) {
    const activeEpisode = store
      ? store.getActiveForAccount(snapshot.accountId)
      : persistAllowed
        ? await loadActiveNeedsMoreEpisodeForAccount(supabase, snapshot.accountId)
        : null;
    const plan = planNeedsMoreTargetsEpisodeReconciliation({
      ...snapshot,
      activeEpisode,
      now,
    });
    plans.push(plan);

    for (const action of plan.actions) {
      if (action.type === "open_episode") episodesOpened += 1;
      if (action.type === "close_episode") episodesClosed += 1;
      if (action.type === "plan_send") plannedSends += 1;
    }

    if (store) {
      store.applyPlan(plan, {
        accountId: snapshot.accountId,
        clientId: snapshot.clientId,
        now,
      });
    } else if (persistAllowed) {
      for (const action of plan.actions) {
        if (action.type === "open_episode") {
          const persisted = await persistNeedsMoreOpenEpisode(supabase, {
            accountId: snapshot.accountId,
            clientId: snapshot.clientId,
            episodeKey: action.episodeKey,
            startedAtIso: action.startedAtIso,
            eligibleTargetCount: action.eligibleTargetCount,
            sourceActionId: action.sourceActionId,
            now,
          });
          if (persisted.created) persistedOpens += 1;
        }
        if (action.type === "close_episode") {
          const closed = await persistNeedsMoreCloseEpisode(supabase, {
            accountId: snapshot.accountId,
            closeReason: action.closeReason,
            now,
          });
          if (closed) {
            persistedCloses += 1;
            intentsCanceled += await cancelPendingNeedsMoreIntentsForAccount(supabase, {
              accountId: snapshot.accountId,
              reason: action.closeReason,
              now,
            });
          }
        }
      }
    }
  }

  return {
    automationGateOpen: gate.allowed,
    sequenceSchemaReady: schema.available,
    persistAllowed,
    postmarkFetchCount: 0,
    intentsCreated: 0,
    episodesOpened,
    episodesClosed,
    plannedSends,
    plans,
    gateReason: gate.allowed ? null : gate.message,
    persistedOpens,
    persistedCloses,
    intentsCanceled,
  };
}
