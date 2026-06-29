import { loadTargetEligibilityCountsByAccount } from "./account-target-eligibility.ts";
import { maskEmailForDisplay } from "./client-email-test-config.ts";
import {
  projectClientContactEmailDisplay,
  resolveClientCommunicationEmail,
} from "./client-communication-email.ts";
import {
  computeNeedsMoreFirstReminderDueAt,
  evaluateNeedsMoreReminderDue,
  type NeedsMoreReminderDueReason,
} from "./client-email-needs-more-24h-due.ts";
import {
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE,
  listDueReminderIndexes,
  planNeedsMoreTargetsEpisodeReconciliation,
  scheduledForAfterEpisodeStart,
  type NeedsMoreTargetsSequenceRecord,
} from "./client-email-needs-more-targets-sequence.ts";
import {
  probeNeedsMoreTargetsSequenceSchema,
  projectSequenceRecord,
} from "./client-email-needs-more-targets-reconcile.ts";
import {
  NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
  NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
  loadActiveNeedsMoreTargetAccountsAction,
  resolveNeedsMoreActiveSince,
} from "./needs-more-target-accounts.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

type SupabaseRecord = Record<string, unknown>;

const ACTIVE_ACTION_STATUSES = ["pending", "acknowledged", "pending_verification"] as const;

export type NeedsMoreTargetsLifecycleDecision =
  | "would_open_episode"
  | "would_keep_active"
  | "would_resolve_episode"
  | "no_action";

export type NeedsMoreTargetsDeliveryState =
  | "delivery_ready"
  | "blocked_missing_client_email"
  | "blocked_canceled_account"
  | "blocked_inactive_signal"
  | "blocked_target_count_above_threshold";

export type NeedsMoreTargetsEpisodePreviewState =
  | "none"
  | "active"
  | "resolved"
  | "canceled";

export type NeedsMoreTargetsPreviewAccountRow = {
  instagramUsername: string | null;
  clientLabel: string | null;
  clientEmailMasked: string | null;
  needsMoreSignalActive: boolean;
  eligibleTargetCount: number;
  threshold: number;
  accountStatus: "active" | "canceled";
  episodeState: NeedsMoreTargetsEpisodePreviewState;
  lifecycleDecision: NeedsMoreTargetsLifecycleDecision;
  deliveryState: NeedsMoreTargetsDeliveryState;
  nextDueAt: string | null;
  nextReminderIndex: number | null;
  dueReason: NeedsMoreReminderDueReason | null;
  reason: string;
};

export type NeedsMoreTargetsLifecyclePreviewSummary = {
  wouldOpenEpisode: number;
  activeEpisodes: number;
  blockedMissingClientEmail: number;
  resolvedOrAboveThreshold: number;
  canceled: number;
  noAction: number;
  wouldKeepActive: number;
  wouldResolveEpisode: number;
};

export type NeedsMoreTargetsLifecyclePreview = {
  previewedAt: string;
  readOnly: true;
  mutationExecuted: false;
  sequenceSchemaReady: boolean;
  accountsAnalyzed: number;
  summary: NeedsMoreTargetsLifecyclePreviewSummary;
  items: NeedsMoreTargetsPreviewAccountRow[];
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function isAccountCanceled(adminLifecycleStatus: string) {
  const normalized = adminLifecycleStatus.trim().toLowerCase();
  return normalized === "cancelled" || normalized === "canceled";
}

function deriveLifecycleDecision(
  plan: ReturnType<typeof planNeedsMoreTargetsEpisodeReconciliation>,
  activeEpisode: NeedsMoreTargetsSequenceRecord | null,
): NeedsMoreTargetsLifecycleDecision {
  if (plan.actions.some((action) => action.type === "close_episode")) {
    return "would_resolve_episode";
  }
  if (plan.actions.some((action) => action.type === "open_episode")) {
    return "would_open_episode";
  }
  if (activeEpisode?.status === "active") {
    return "would_keep_active";
  }
  return "no_action";
}

function deriveDeliveryState(input: {
  accountCanceled: boolean;
  needsMoreSignalActive: boolean;
  eligibleTargetCount: number;
  clientEmailAvailable: boolean;
}): NeedsMoreTargetsDeliveryState {
  if (input.accountCanceled) return "blocked_canceled_account";
  if (!input.needsMoreSignalActive) return "blocked_inactive_signal";
  if (input.eligibleTargetCount > NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD) {
    return "blocked_target_count_above_threshold";
  }
  if (!input.clientEmailAvailable) return "blocked_missing_client_email";
  return "delivery_ready";
}

function computeNextTheoreticalDue(
  input: {
    activeEpisode: NeedsMoreTargetsSequenceRecord | null;
    needsMoreActiveSince: string | null;
    now: Date;
  },
) {
  const startedAtIso = input.activeEpisode?.startedAt ?? input.needsMoreActiveSince;
  if (!startedAtIso) {
    return { reminderIndex: null, dueAt: null };
  }
  const startedAt = new Date(startedAtIso);
  const lastDone = input.activeEpisode?.lastCompletedReminderIndex ?? -1;
  for (const index of [0]) {
    if (index <= lastDone) continue;
    const scheduledFor = scheduledForAfterEpisodeStart(startedAt, index);
    if (!scheduledFor) continue;
    if (scheduledFor.getTime() > input.now.getTime()) {
      return { reminderIndex: index, dueAt: scheduledFor.toISOString() };
    }
  }
  const dueNow = listDueReminderIndexes({
    startedAt,
    now: input.now,
    lastCompletedReminderIndex: lastDone,
  });
  const nextIndex = dueNow.find((index) => index > lastDone) ?? null;
  if (nextIndex == null) {
    const fallbackDueAt = computeNeedsMoreFirstReminderDueAt(startedAtIso);
    return { reminderIndex: 0, dueAt: fallbackDueAt };
  }
  const scheduledFor = scheduledForAfterEpisodeStart(startedAt, nextIndex);
  return {
    reminderIndex: nextIndex,
    dueAt: scheduledFor?.toISOString() ?? null,
  };
}

function buildPreviewReason(input: {
  lifecycleDecision: NeedsMoreTargetsLifecycleDecision;
  deliveryState: NeedsMoreTargetsDeliveryState;
  accountCanceled: boolean;
  needsMoreSignalActive: boolean;
  eligibleTargetCount: number;
  clientEmailAvailable: boolean;
  episodeState: NeedsMoreTargetsEpisodePreviewState;
  closeReason?: string | null;
}) {
  const parts: string[] = [];
  parts.push(`Eligible target count is ${input.eligibleTargetCount} (threshold ${NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD}).`);
  parts.push(input.needsMoreSignalActive
    ? "Needs-more target accounts signal is active."
    : "Needs-more target accounts signal is inactive or resolved.");
  if (input.accountCanceled) parts.push("Account is canceled.");
  if (input.episodeState === "active") parts.push("An active lifecycle episode exists.");
  if (input.episodeState === "none") parts.push("No lifecycle episode is stored yet.");

  switch (input.lifecycleDecision) {
    case "would_open_episode":
      parts.push("Engine would open a new lifecycle episode.");
      break;
    case "would_keep_active":
      parts.push("Engine would keep the current episode active.");
      break;
    case "would_resolve_episode":
      if (input.closeReason === "account_canceled") {
        parts.push("Engine would cancel the active episode.");
      } else {
        parts.push("Engine would resolve the active episode.");
      }
      break;
    default:
      parts.push("No lifecycle episode action is due.");
      break;
  }

  switch (input.deliveryState) {
    case "delivery_ready":
      parts.push("Canonical client email is available for future delivery.");
      break;
    case "blocked_missing_client_email":
      parts.push("Delivery would be blocked until a canonical client communication email is configured.");
      break;
    case "blocked_canceled_account":
      parts.push("Delivery would remain blocked while the account is canceled.");
      break;
    case "blocked_inactive_signal":
      parts.push("Delivery would remain blocked while the needs-more signal is inactive.");
      break;
    case "blocked_target_count_above_threshold":
      parts.push("Delivery would remain blocked while eligible targets stay above the threshold.");
      break;
    default:
      break;
  }

  parts.push("Read-only preview — no database write, intent, or email was performed.");
  return parts.join(" ");
}

async function loadPertinentAccountIds(supabase: ClientEmailSupabase, sequenceSchemaReady: boolean) {
  const accountIds = new Set<string>();

  const { data: signalRows, error: signalError } = await supabase
    .from("account_dashboard_actions")
    .select("account_id")
    .eq("action_type", NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE)
    .in("status", [...ACTIVE_ACTION_STATUSES]);
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

async function loadAccountContextById(supabase: ClientEmailSupabase, accountIds: string[]) {
  if (accountIds.length === 0) return new Map<string, {
    clientId: string;
    instagramUsername: string | null;
    clientLabel: string | null;
    clientRow: SupabaseRecord | null;
    adminLifecycleStatus: string;
  }>();

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
    supabase
      .from("ig_accounts")
      .select("id,username,admin_lifecycle_status")
      .in("id", accountIds),
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
    adminLifecycleStatus: string;
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
      adminLifecycleStatus: readString(account?.admin_lifecycle_status, ""),
    });
  }

  return out;
}

async function loadActiveEpisodesByAccount(
  supabase: ClientEmailSupabase,
  accountIds: string[],
  sequenceSchemaReady: boolean,
) {
  const out = new Map<string, NeedsMoreTargetsSequenceRecord>();
  if (!sequenceSchemaReady || accountIds.length === 0) return out;

  const { data, error } = await supabase
    .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
    .select("*")
    .in("account_id", accountIds)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const episode = projectSequenceRecord(row as SupabaseRecord);
    if (episode.accountId) out.set(episode.accountId, episode);
  }
  return out;
}

function summarizeItems(items: NeedsMoreTargetsPreviewAccountRow[]): NeedsMoreTargetsLifecyclePreviewSummary {
  return {
    wouldOpenEpisode: items.filter((item) => item.lifecycleDecision === "would_open_episode").length,
    activeEpisodes: items.filter((item) => item.episodeState === "active").length,
    blockedMissingClientEmail: items.filter((item) => item.deliveryState === "blocked_missing_client_email").length,
    resolvedOrAboveThreshold: items.filter((item) =>
      item.lifecycleDecision === "would_resolve_episode"
      && (item.deliveryState === "blocked_target_count_above_threshold"
        || !item.needsMoreSignalActive)).length,
    canceled: items.filter((item) => item.accountStatus === "canceled").length,
    noAction: items.filter((item) => item.lifecycleDecision === "no_action").length,
    wouldKeepActive: items.filter((item) => item.lifecycleDecision === "would_keep_active").length,
    wouldResolveEpisode: items.filter((item) => item.lifecycleDecision === "would_resolve_episode").length,
  };
}

export async function loadNeedsMoreTargetsEmailLifecyclePreview(
  supabase: ClientEmailSupabase,
  input: { now?: Date } = {},
): Promise<NeedsMoreTargetsLifecyclePreview> {
  const now = input.now ?? new Date();
  const schema = await probeNeedsMoreTargetsSequenceSchema(supabase);
  const accountIds = await loadPertinentAccountIds(supabase, schema.available);

  if (accountIds.length === 0) {
    return {
      previewedAt: now.toISOString(),
      readOnly: true,
      mutationExecuted: false,
      sequenceSchemaReady: schema.available,
      accountsAnalyzed: 0,
      summary: {
        wouldOpenEpisode: 0,
        activeEpisodes: 0,
        blockedMissingClientEmail: 0,
        resolvedOrAboveThreshold: 0,
        canceled: 0,
        noAction: 0,
        wouldKeepActive: 0,
        wouldResolveEpisode: 0,
      },
      items: [],
    };
  }

  const [contextByAccount, eligibilityByAccount, episodesByAccount] = await Promise.all([
    loadAccountContextById(supabase, accountIds),
    loadTargetEligibilityCountsByAccount(supabase, accountIds),
    loadActiveEpisodesByAccount(supabase, accountIds, schema.available),
  ]);

  const items: NeedsMoreTargetsPreviewAccountRow[] = [];

  for (const accountId of accountIds.sort()) {
    const context = contextByAccount.get(accountId);
    if (!context) continue;

    const eligibleTargetCount = eligibilityByAccount.get(accountId)?.eligible ?? 0;
    const activeAction = await loadActiveNeedsMoreTargetAccountsAction(supabase, accountId);
    const needsMoreSignalActive = Boolean(activeAction?.id);
    const accountCanceled = isAccountCanceled(context.adminLifecycleStatus);
    const activeEpisode = episodesByAccount.get(accountId) ?? null;
    const episodeState: NeedsMoreTargetsEpisodePreviewState = activeEpisode?.status ?? "none";

    const resolvedEmail = resolveClientCommunicationEmail({
      client: context.clientRow,
      workspaceAuthEmail: null,
    });
    const projectedEmail = projectClientContactEmailDisplay(resolvedEmail);
    const clientEmailMasked = projectedEmail.available
      ? maskEmailForDisplay(projectedEmail.display)
      : null;

    const needsMoreActiveSince = resolveNeedsMoreActiveSince(activeAction);

    const plan = planNeedsMoreTargetsEpisodeReconciliation({
      accountId,
      clientId: context.clientId,
      accountCanceled,
      eligibleTargetCount,
      needsMoreSignalActive,
      sourceActionId: readString(activeAction?.id, "") || null,
      needsMoreActiveSince,
      activeEpisode,
      now,
    });

    const lifecycleDecision = deriveLifecycleDecision(plan, activeEpisode);
    const deliveryState = deriveDeliveryState({
      accountCanceled,
      needsMoreSignalActive,
      eligibleTargetCount,
      clientEmailAvailable: projectedEmail.available,
    });

    const dueEvaluation = evaluateNeedsMoreReminderDue({
      needsMoreActiveSince,
      now,
      eligibleTargetCount,
      needsMoreSignalActive,
      accountCanceled,
      clientEmailAvailable: projectedEmail.available,
    });

    const closeAction = plan.actions.find((action) => action.type === "close_episode");
    const nextDue = computeNextTheoreticalDue({
      activeEpisode,
      needsMoreActiveSince,
      now,
    });

    items.push({
      instagramUsername: context.instagramUsername,
      clientLabel: context.clientLabel,
      clientEmailMasked,
      needsMoreSignalActive,
      eligibleTargetCount,
      threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
      accountStatus: accountCanceled ? "canceled" : "active",
      episodeState,
      lifecycleDecision,
      deliveryState,
      nextDueAt: nextDue.dueAt,
      nextReminderIndex: nextDue.reminderIndex,
      dueReason: dueEvaluation.reason,
      reason: buildPreviewReason({
        lifecycleDecision,
        deliveryState,
        accountCanceled,
        needsMoreSignalActive,
        eligibleTargetCount,
        clientEmailAvailable: projectedEmail.available,
        episodeState,
        closeReason: closeAction?.type === "close_episode" ? closeAction.closeReason : null,
      }),
    });
  }

  return {
    previewedAt: now.toISOString(),
    readOnly: true,
    mutationExecuted: false,
    sequenceSchemaReady: schema.available,
    accountsAnalyzed: items.length,
    summary: summarizeItems(items),
    items,
  };
}
