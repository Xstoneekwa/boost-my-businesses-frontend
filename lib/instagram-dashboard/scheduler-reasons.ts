/**
 * CP1 — Canonical scheduler reason nomenclature.
 *
 * Single projection-time contract for every reason surfaced by the Scheduler
 * observability chain (auto-restart tick decisions, schedule-session cron,
 * automatic enqueue rejections, scheduler-status read-model, BotApp view).
 *
 * Rules:
 * - business rules are NOT redefined here: raw reasons stay persisted as-is,
 *   this module only normalizes them to stable `reason_code`s with short
 *   operator labels at projection time;
 * - technical errors stay distinct from business blocks (`kind`);
 * - `reason_unavailable` is the only acceptable outcome when no canonical
 *   data allows a conclusion — nothing is ever invented;
 * - every label is short, redaction-safe (labels are static; raw reasons are
 *   already redacted upstream by sanitizeTickFailureReason and the decision
 *   writers).
 */

export const REASON_UNAVAILABLE = "reason_unavailable";

export type SchedulerReasonKind = "business" | "technical" | "config" | "unavailable";

type ReasonDescriptor = { label: string; kind: SchedulerReasonKind };

/** Canonical reason codes → short operator labels. */
export const SCHEDULER_REASON_CONTRACT: Record<string, ReasonDescriptor> = {
  // Engine / toggle states
  scheduler_disabled: { label: "scheduler disabled", kind: "config" },
  technical_disabled: { label: "daily cron disabled (env)", kind: "config" },
  dry_run: { label: "dry run", kind: "config" },
  settings_patch: { label: "configuration updated", kind: "config" },
  scheduler_disabled_race_rejected: { label: "rejected: scheduler turned OFF", kind: "config" },

  // Resume engine (Auto Restart)
  resume_plan_missing: { label: "resume plan missing", kind: "business" },
  no_recent_run: { label: "no recent run", kind: "business" },
  resume_runtime_not_supported: { label: "resume not supported", kind: "business" },
  restart_not_allowed: { label: "restart not allowed", kind: "business" },
  restart_delay_pending: { label: "restart delay pending", kind: "business" },
  max_attempts_reached: { label: "attempt cap reached", kind: "business" },
  max_restarts_day: { label: "daily cap reached", kind: "business" },
  max_restarts_window: { label: "window cap reached", kind: "business" },
  restart_red_disabled: { label: "risk policy (red)", kind: "business" },
  restart_yellow_disabled: { label: "risk policy (yellow)", kind: "business" },

  // Runtime / infrastructure
  botapp_runtime_unavailable: { label: "BotApp runtime unavailable", kind: "business" },
  dispatcher_unavailable: { label: "dispatcher unavailable", kind: "business" },
  device_heartbeat_stale: { label: "phone heartbeat stale", kind: "business" },
  device_unavailable: { label: "phone unavailable", kind: "business" },
  device_lock_held: { label: "phone busy (lock held)", kind: "business" },
  phone_busy: { label: "phone busy", kind: "business" },
  phone_rest_active: { label: "phone rest active", kind: "business" },

  // Account state
  active_run_exists: { label: "run already active", kind: "business" },
  active_request_exists: { label: "run already requested", kind: "business" },
  assignment_window_closed: { label: "outside window", kind: "business" },
  assignment_missing: { label: "no assignment", kind: "business" },
  manual_only_requires_manual_trigger: { label: "manual only", kind: "business" },
  no_eligible_targets: { label: "no targets", kind: "business" },
  no_eligible_accounts: { label: "no eligible accounts", kind: "business" },
  readiness_blocked: { label: "readiness blocked", kind: "business" },
  login_not_connected: { label: "login not connected", kind: "business" },
  quota_reached: { label: "quota reached", kind: "business" },
  open_incident_blocked: { label: "open incident", kind: "business" },
  challenge_blocked: { label: "challenge pending", kind: "business" },
  restriction_blocked: { label: "restriction detected", kind: "business" },
  account_mismatch_blocked: { label: "account mismatch", kind: "business" },
  device_offline_blocked: { label: "phone offline", kind: "business" },
  account_blocking_action_or_credentials: { label: "action or credentials required", kind: "business" },
  assignment_or_device_pending: { label: "assignment to verify", kind: "business" },
  eligible: { label: "eligible", kind: "business" },

  // Technical errors (never conflated with business blocks)
  enqueue_failed: { label: "enqueue failed", kind: "technical" },
  unexpected_tick_error: { label: "unexpected tick error", kind: "technical" },
  tick_failed: { label: "tick failed", kind: "technical" },
  eligibility_query_failed: { label: "eligibility read failed", kind: "technical" },
  dispatcher_health_read_failed: { label: "dispatcher health read failed", kind: "technical" },

  // Explicit non-answer: shown as "reason unavailable", never invented.
  [REASON_UNAVAILABLE]: { label: "reason unavailable", kind: "unavailable" },
};

/**
 * Raw persisted values (legacy or emitter-specific) → canonical codes.
 * Only aliases live here; stored data is never rewritten.
 */
const REASON_ALIASES: Record<string, string> = {
  unknown: REASON_UNAVAILABLE,
  "": REASON_UNAVAILABLE,
  blocked: REASON_UNAVAILABLE,
  already_running: "active_run_exists",
  account_already_running: "active_run_exists",
  already_requested: "active_request_exists",
  account_run_already_requested: "active_request_exists",
  active_run_request_exists: "active_request_exists",
  no_quota_remaining: "quota_reached",
  cap_reached: "quota_reached",
  outside_schedule_window: "assignment_window_closed",
  outside_assignment_window: "assignment_window_closed",
  no_active_schedule_window: "assignment_window_closed",
  no_active_windows: "assignment_window_closed",
  skipped_phone_busy: "phone_busy",
  skipped_stale_device: "device_heartbeat_stale",
  skipped_emulator_device: "device_unavailable",
  dispatcher_unhealthy: "dispatcher_unavailable",
  dispatcher_unconfigured: "dispatcher_unavailable",
  dispatcher_not_running: "dispatcher_unavailable",
  readiness_not_ready: "readiness_blocked",
  login_required: "login_not_connected",
  auto_restart_enqueue_failed: "enqueue_failed",
  schedule_session_enqueue_failed: "enqueue_failed",
  cron_disabled: "technical_disabled",
};

const PREFIX_CODES: Array<{ prefix: string; code: string }> = [
  // Worker resume-plan blocks keep their payload in the raw reason (tooltip);
  // the code stays stable for filtering/alerting.
  { prefix: "worker_plan:resume_plan_missing", code: "resume_plan_missing" },
  { prefix: "worker_plan:no_recent_run", code: "no_recent_run" },
  { prefix: "worker_plan:", code: "restart_not_allowed" },
  { prefix: "unsafe_markers:", code: "readiness_blocked" },
];

export type NormalizedSchedulerReason = {
  /** Stable canonical code, safe for filtering, alerting and UI mapping. */
  code: string;
  /** Short operator label. */
  label: string;
  /** business | technical | config | unavailable */
  kind: SchedulerReasonKind;
  /** Raw (already redacted) persisted reason, kept for tooltips/forensics. */
  raw: string;
};

/**
 * Normalizes a persisted reason (possibly a comma-joined list — the first
 * entry is the primary cause) into the canonical contract. A reason that the
 * backend genuinely cannot explain maps to `reason_unavailable`; a reason
 * outside the contract keeps its own (already redacted) value as code with a
 * passthrough label so nothing is hidden or invented.
 */
export function normalizeSchedulerReason(rawReason: unknown): NormalizedSchedulerReason {
  const raw = typeof rawReason === "string" ? rawReason.trim() : "";
  const first = raw.split(",")[0]?.trim() ?? "";
  const aliased = first in REASON_ALIASES ? REASON_ALIASES[first] : first.toLowerCase() in REASON_ALIASES ? REASON_ALIASES[first.toLowerCase()] : first;

  const prefixMatch = PREFIX_CODES.find((entry) => aliased.startsWith(entry.prefix));
  const code = prefixMatch ? prefixMatch.code : aliased || REASON_UNAVAILABLE;

  const descriptor = SCHEDULER_REASON_CONTRACT[code];
  if (descriptor) {
    return { code, label: descriptor.label, kind: descriptor.kind, raw };
  }
  // Unknown-but-real canonical reason: pass through unchanged (never invented,
  // never masked as unavailable).
  return { code, label: code, kind: "business", raw };
}

/** True when the reason denotes a technical failure rather than a business block. */
export function isTechnicalSchedulerReason(reason: NormalizedSchedulerReason) {
  return reason.kind === "technical";
}
