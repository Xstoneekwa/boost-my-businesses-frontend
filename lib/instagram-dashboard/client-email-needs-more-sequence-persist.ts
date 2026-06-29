import {
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE,
  type NeedsMoreTargetsSequenceRecord,
} from "./client-email-needs-more-targets-sequence.ts";
import type { ClientEmailNeedsMoreTargetsSequenceCloseReason } from "./client-email-constants.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

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

function projectSequenceRecord(row: SupabaseRecord): NeedsMoreTargetsSequenceRecord {
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

export async function loadActiveNeedsMoreEpisodeForAccount(
  supabase: ClientEmailSupabase,
  accountId: string,
): Promise<NeedsMoreTargetsSequenceRecord | null> {
  const { data, error } = await supabase
    .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
    .select("*")
    .eq("account_id", accountId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return projectSequenceRecord(data as SupabaseRecord);
}

export async function persistNeedsMoreOpenEpisode(
  supabase: ClientEmailSupabase,
  input: {
    accountId: string;
    clientId: string;
    episodeKey: string;
    startedAtIso: string;
    eligibleTargetCount: number;
    sourceActionId: string | null;
    now: Date;
  },
): Promise<{ created: boolean; episode: NeedsMoreTargetsSequenceRecord | null }> {
  const existing = await loadActiveNeedsMoreEpisodeForAccount(supabase, input.accountId);
  if (existing) {
    return { created: false, episode: existing };
  }

  const nowIso = input.now.toISOString();
  const { data, error } = await supabase
    .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
    .insert({
      account_id: input.accountId,
      client_id: input.clientId,
      source_action_id: input.sourceActionId,
      status: "active",
      eligible_target_count_at_start: input.eligibleTargetCount,
      threshold_at_start: 5,
      started_at: input.startedAtIso,
      episode_key: input.episodeKey,
      next_reminder_index: 0,
      last_completed_reminder_index: null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    const message = error.message?.toLowerCase() ?? "";
    if (message.includes("duplicate") || message.includes("unique") || message.includes("active_account")) {
      const episode = await loadActiveNeedsMoreEpisodeForAccount(supabase, input.accountId);
      return { created: false, episode };
    }
    throw new Error(error.message);
  }

  return {
    created: Boolean(data),
    episode: data ? projectSequenceRecord(data as SupabaseRecord) : null,
  };
}

export async function persistNeedsMoreCloseEpisode(
  supabase: ClientEmailSupabase,
  input: {
    accountId: string;
    closeReason: ClientEmailNeedsMoreTargetsSequenceCloseReason;
    now: Date;
  },
): Promise<boolean> {
  const active = await loadActiveNeedsMoreEpisodeForAccount(supabase, input.accountId);
  if (!active) return false;

  const nowIso = input.now.toISOString();
  const isCanceled = input.closeReason === "account_canceled";
  const { error } = await supabase
    .from(CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCES_TABLE)
    .update({
      status: isCanceled ? "canceled" : "resolved",
      close_reason: input.closeReason,
      resolved_at: isCanceled ? null : nowIso,
      canceled_at: isCanceled ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("id", active.id)
    .eq("status", "active");

  if (error) throw new Error(error.message);
  return true;
}

export async function cancelPendingNeedsMoreIntentsForAccount(
  supabase: ClientEmailSupabase,
  input: {
    accountId: string;
    reason: string;
    now: Date;
  },
): Promise<number> {
  const nowIso = input.now.toISOString();
  const { data, error } = await supabase
    .from("client_email_send_intents")
    .update({
      status: "canceled",
      resolved_at: nowIso,
      dispatch_last_error_code: input.reason.slice(0, 120),
    })
    .eq("account_id", input.accountId)
    .eq("category", "needs_more_target_accounts")
    .in("status", ["pending", "scheduled", "claimed"])
    .is("provider_message_id", null)
    .select("id");

  if (error) throw new Error(error.message);
  return (data ?? []).length;
}
