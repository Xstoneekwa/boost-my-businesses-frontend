import type { createSupabaseClient } from "./supabase";

export const ACCOUNT_SESSION_TRANSITION_SCHEMA = "account_session_transition_v1" as const;
export const ACCOUNT_SESSION_TRANSITION_STATES = ["initiated", "no_work", "blocked", "partial", "completed"] as const;

export type AccountSessionTransitionState = typeof ACCOUNT_SESSION_TRANSITION_STATES[number];

export type AccountSessionTransitionView = {
  id: string;
  accountId: string;
  runId: string;
  transitionKey: string;
  state: AccountSessionTransitionState;
  context: "business_deadline";
  type: "follow_to_unfollow";
  followsCompleted: number | null;
  followsRemaining: number | null;
  safeBoundary: boolean | null;
  unfollowEligible: boolean | null;
  unfollowStarted: boolean;
  unfollowState: string | null;
  backlogRemaining: number | null;
  nextStep: string | null;
  exactStableReason: string;
  actionableReason: string | null;
  updatedAt: string;
};

type Supabase = ReturnType<typeof createSupabaseClient>;
type Row = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function projectAccountSessionTransitionRow(row: Row): AccountSessionTransitionView {
  const rawState = text(row.transition_state, "initiated");
  const state = (ACCOUNT_SESSION_TRANSITION_STATES as readonly string[]).includes(rawState)
    ? rawState as AccountSessionTransitionState
    : "initiated";
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    runId: text(row.run_id),
    transitionKey: text(row.transition_key),
    state,
    context: "business_deadline",
    type: "follow_to_unfollow",
    followsCompleted: numberOrNull(row.follows_completed),
    followsRemaining: numberOrNull(row.follows_remaining),
    safeBoundary: booleanOrNull(row.safe_boundary),
    unfollowEligible: booleanOrNull(row.unfollow_eligible),
    unfollowStarted: row.unfollow_started === true,
    unfollowState: text(row.unfollow_state) || null,
    backlogRemaining: numberOrNull(row.backlog_remaining),
    nextStep: text(row.next_step) || null,
    exactStableReason: text(row.exact_stable_reason, "follow_to_unfollow_time_handoff"),
    actionableReason: text(row.actionable_reason) || null,
    updatedAt: text(row.updated_at),
  };
}

export function selectCurrentAccountSessionTransition(
  rows: Row[],
  activeRunId: string,
): AccountSessionTransitionView | null {
  if (!activeRunId) return null;
  const current = rows
    .map((row) => projectAccountSessionTransitionRow(row))
    .filter((transition) => transition.runId === activeRunId && transition.state === "initiated")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return current ?? null;
}

const TRANSITION_SELECT = "id,account_id,run_id,transition_key,transition_state,transition_context,transition_type,follows_completed,follows_remaining,safe_boundary,unfollow_eligible,unfollow_started,unfollow_state,backlog_remaining,next_step,exact_stable_reason,actionable_reason,updated_at";

export async function loadAccountSessionTransitions(
  supabase: Supabase,
  accountIds: string[],
  limit = 100,
): Promise<AccountSessionTransitionView[]> {
  if (!accountIds.length) return [];
  const { data, error } = await supabase
    .from("account_session_transitions")
    .select(TRANSITION_SELECT)
    .in("account_id", [...new Set(accountIds)])
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (message.includes("account_session_transitions") && (message.includes("does not exist") || message.includes("schema cache"))) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => projectAccountSessionTransitionRow(row as Row));
}

export function clientTransitionCopy(state: AccountSessionTransitionState, lang: "fr" | "en") {
  const fr = {
    initiated: "La phase Follow s'est arrêtée pour laisser la place à Unfollow. Le travail restant sera repris automatiquement.",
    no_work: "La phase Follow s'est terminée. Aucun compte n'était prêt pour Unfollow pendant cette session.",
    blocked: "Le passage à Unfollow nécessite une vérification de notre équipe.",
    partial: "Une partie des Unfollows a été effectuée. Le travail restant sera repris automatiquement lors de la prochaine session éligible.",
    completed: "La phase Unfollow de cette session est terminée.",
  } as const;
  const en = {
    initiated: "The Follow phase stopped to make room for Unfollow. Remaining work will resume automatically.",
    no_work: "The Follow phase ended. No accounts were ready for Unfollow during this session.",
    blocked: "The transition to Unfollow needs a check from our team.",
    partial: "Some Unfollows were completed. Remaining work will resume automatically in the next eligible session.",
    completed: "The Unfollow phase for this session is complete.",
  } as const;
  return (lang === "fr" ? fr : en)[state];
}
