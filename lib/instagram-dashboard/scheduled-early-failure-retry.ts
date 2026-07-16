import { randomUUID } from "node:crypto";

import {
  buildSchedulerSessionMetadata,
  deriveAssignmentTransitionTimestamps,
  handoffPreflightLeaseToSchedulerRequest,
} from "./scheduled-session-preflight.ts";
import {
  acquireDeviceSessionLock,
  bindDeviceSessionLockToRequest,
  defaultDeviceLockLeaseSeconds,
  pendingManualLockWorkerId,
} from "./device-session-lock.ts";
import {
  isBusinessActionsAllowed,
  type SessionTransitionTimestamps,
} from "./session-transition-buffer.ts";
import { deliverOperatorReviewNotifications } from "./operator-review-notifications.ts";
import { buildCanonicalIncidentNotification } from "./canonical-incident-notification.ts";
export function scheduleSessionIdempotencyKey(assignmentId: string, startsAt: string) {
  return `schedule-session:${assignmentId}:${startsAt}`;
}

export const SCHEDULED_EARLY_FAILURE_RETRY_POLICY = "scheduled_early_failure_retry_v1";
export const CONTROLLED_RETRY_MAX_INDEX = 1;

export const INCIDENT_TYPE_EARLY_FAILURE_RETRYING = "scheduled_early_failure_retrying";
export const INCIDENT_TYPE_RETRY_FAILED = "scheduled_retry_failed";
export const INCIDENT_TYPE_UNSAFE_NO_RETRY = "scheduled_run_failed_unsafe_no_retry";

export const DASHBOARD_ACTION_TYPE_EARLY_RETRY = "scheduled_early_failure_retry";
export const DASHBOARD_ACTION_TYPE_OPERATOR_REVIEW = "operator_review_required";

export type ScheduledEarlyFailureClassification =
  | "TRANSIENT_UI_FAILURE"
  | "TARGET_ENTRY_FAILURE"
  | "SOURCE_PROFILE_NOT_OPENED"
  | "FOLLOWERS_LIST_ENTRY_FAILED"
  | "IDENTITY_GUARD_FAILED"
  | "WRONG_LOGGED_IN_ACCOUNT"
  | "DEVICE_OR_PACKAGE_FAILURE"
  | "WORKER_CODE_BUG"
  | "CONFIG_OR_TARGET_DATA_BUG"
  | "UNKNOWN";

export const UNSAFE_EARLY_FAILURE_REASON_CODES = [
  "active_instagram_account_mismatch",
  "identity_mismatch",
  "wrong_logged_in_account",
  "login_challenge",
  "checkpoint",
  "login_screen_detected",
  "account_login_required",
  "identity_guard_failed",
  "run_identity_verification_failed",
  "assigned_instagram_package_unavailable",
  "package_mismatch",
  "device_package_mismatch",
  "device_unavailable",
  "repeated_crash",
  "deadline_expired",
  "business_action_already_performed",
] as const;

export const SAFE_RETRYABLE_EARLY_FAILURE_REASON_CODES = [
  "welcome_surface_unstable",
  "followers_surface_missing_at_start",
  "welcome_sender_failed",
  "welcome_scan_failed",
  "target_entry_transient",
  "surface_not_loaded",
  "recoverable_failure",
  "worker_failed_before_business_action",
  "transient_ui_failure",
] as const;

const TERMINAL_REQUEST_STATUSES = new Set(["failed", "canceled", "cancelled", "completed", "stopped"]);
const ACTIVE_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running", "pending", "reserved"]);

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  like: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder & PromiseLike<QueryResult>;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
  insert: (values: Record<string, unknown> | Record<string, unknown>[]) => QueryBuilder & PromiseLike<QueryResult>;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

export function scheduledSessionControlledRetryIdempotencyKey(
  assignmentId: string,
  startsAt: string,
  retryIndex = CONTROLLED_RETRY_MAX_INDEX,
) {
  return `${scheduleSessionIdempotencyKey(assignmentId, startsAt)}:retry:${retryIndex}`;
}

export function scheduledEarlyFailureIncidentDedupeKey(input: {
  accountId: string;
  assignmentId: string;
  startsAt: string;
  originalRequestId: string;
}) {
  return `scheduled_early_failure_retry:${input.accountId}:${input.assignmentId}:${input.startsAt}:${input.originalRequestId}`;
}

export function scheduledEarlyFailureDashboardActionDedupeKey(input: {
  accountId: string;
  assignmentId: string;
  startsAt: string;
}) {
  return `account:${input.accountId}:scheduled_early_failure_retry:${input.assignmentId}:${input.startsAt}`;
}

export function countBusinessActionsFromRunMetadata(metadata: unknown): number {
  const meta = readRecord(metadata);
  const counters = [
    "follows_completed_count",
    "likes_completed_count",
    "dms_sent_count",
    "unfollows_completed_count",
    "mutes_completed_count",
    "business_actions_count",
    "total_follow",
    "total_like",
    "total_dm",
  ];
  let total = 0;
  for (const key of counters) {
    total += readCount(meta[key]);
  }
  if (total > 0) return total;

  const summary = readRecord(meta.account_session_summary);
  for (const key of counters) {
    total += readCount(summary[key]);
  }
  if (total > 0) return total;

  const performance = readRecord(meta.performance_summary);
  const sessionCounters = readRecord(performance.session_counters);
  total += readCount(sessionCounters.follows);
  total += readCount(sessionCounters.likes);
  total += readCount(sessionCounters.pm);
  total += readCount(sessionCounters.unfollows);
  total += readCount(sessionCounters.successful_interactions);
  if (total > 0) return total;

  total += readCount(meta.welcome_sender_jobs_sent_count);
  return total;
}

export function classifyScheduledEarlyFailure(input: {
  reasonCode?: string | null;
  transitionReason?: string | null;
  failureReason?: string | null;
  exitCode?: number | null;
}): ScheduledEarlyFailureClassification {
  const reason = readString(input.reasonCode || input.transitionReason || input.failureReason).toLowerCase();
  if (!reason) return "UNKNOWN";
  if (reason.includes("identity") && reason.includes("mismatch")) return "WRONG_LOGGED_IN_ACCOUNT";
  if (reason.includes("identity_guard")) return "IDENTITY_GUARD_FAILED";
  if (reason.includes("wrong_logged_in") || reason.includes("account_mismatch")) return "WRONG_LOGGED_IN_ACCOUNT";
  if (reason.includes("login") || reason.includes("challenge") || reason.includes("checkpoint")) {
    return "WRONG_LOGGED_IN_ACCOUNT";
  }
  if (reason.includes("package") || reason.includes("device")) return "DEVICE_OR_PACKAGE_FAILURE";
  if (reason.includes("followers_surface") || reason.includes("welcome_surface")) return "TRANSIENT_UI_FAILURE";
  if (reason.includes("target_entry") || reason.includes("source_profile")) return "TARGET_ENTRY_FAILURE";
  if (reason.includes("followers_list")) return "FOLLOWERS_LIST_ENTRY_FAILED";
  if (reason.includes("config") || reason.includes("target_data")) return "CONFIG_OR_TARGET_DATA_BUG";
  return "TRANSIENT_UI_FAILURE";
}

export function isUnsafeEarlyFailureReason(reasonCode: string | null | undefined) {
  const reason = readString(reasonCode).toLowerCase();
  if (!reason) return false;
  return (UNSAFE_EARLY_FAILURE_REASON_CODES as readonly string[]).some((unsafe) => reason.includes(unsafe));
}

export function isSafeRetryableEarlyFailureReason(reasonCode: string | null | undefined) {
  const reason = readString(reasonCode).toLowerCase();
  if (!reason) return false;
  if (isUnsafeEarlyFailureReason(reason)) return false;
  return (SAFE_RETRYABLE_EARLY_FAILURE_REASON_CODES as readonly string[]).some((safe) => reason.includes(safe));
}

export function resolveEarlyFailureReasonCode(input: {
  requestReasonCode?: string | null;
  requestErrorCode?: string | null;
  runMetadata?: unknown;
  exitCode?: number | null;
}) {
  const requestReason = readString(input.requestReasonCode);
  if (requestReason) return requestReason;
  const meta = readRecord(input.runMetadata);
  const transitionReason = readString(meta.transition_reason);
  if (transitionReason) return transitionReason;
  const failureReason = readString(meta.failure_reason);
  if (failureReason) return failureReason;
  const followSkipped = readString(meta.follow_phase_skipped_reason);
  if (followSkipped) return followSkipped;
  const performance = readRecord(meta.performance_summary);
  const performanceExitCode = readCount(performance.exit_code);
  const requestErrorCode = readString(input.requestErrorCode).toLowerCase();
  if (requestErrorCode === "worker_exit_nonzero" && (performanceExitCode === 1 || input.exitCode === 1)) {
    return "worker_failed_before_business_action";
  }
  if (input.exitCode === 1 || performanceExitCode === 1) return "worker_failed_before_business_action";
  return "recoverable_failure";
}

export type ScheduledEarlyFailureRetryEligibility =
  | { eligible: true; classification: ScheduledEarlyFailureClassification; reasonCode: string; businessActionsCount: number }
  | { eligible: false; deniedReason: string; classification: ScheduledEarlyFailureClassification; reasonCode: string; businessActionsCount: number };

export function evaluateScheduledEarlyFailureRetryEligibility(input: {
  now: Date;
  transition: SessionTransitionTimestamps | null;
  preflightStatus: string;
  originalRequestStatus: string;
  reasonCode: string;
  businessActionsCount: number;
  retryAlreadyExists: boolean;
  retryInFlight: boolean;
  retryFailedTerminal: boolean;
}): ScheduledEarlyFailureRetryEligibility {
  const classification = classifyScheduledEarlyFailure({ reasonCode: input.reasonCode });
  const businessActionsCount = Math.max(0, input.businessActionsCount);

  if (input.retryInFlight) {
    return { eligible: false, deniedReason: "retry_in_flight", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (input.retryAlreadyExists || input.retryFailedTerminal) {
    return { eligible: false, deniedReason: "controlled_retry_already_consumed", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (!input.transition || !isBusinessActionsAllowed(input.now, input.transition)) {
    return { eligible: false, deniedReason: "deadline_expired", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (readString(input.preflightStatus).toLowerCase() !== "preflight_ready") {
    return { eligible: false, deniedReason: "preflight_not_ready", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (!TERMINAL_REQUEST_STATUSES.has(readString(input.originalRequestStatus).toLowerCase())) {
    return { eligible: false, deniedReason: "original_request_not_terminal", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (businessActionsCount > 0) {
    return { eligible: false, deniedReason: "business_action_already_performed", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (isUnsafeEarlyFailureReason(input.reasonCode)) {
    return { eligible: false, deniedReason: "unsafe_failure", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (!isSafeRetryableEarlyFailureReason(input.reasonCode) && classification === "WRONG_LOGGED_IN_ACCOUNT") {
    return { eligible: false, deniedReason: "unsafe_failure", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (!isSafeRetryableEarlyFailureReason(input.reasonCode) && classification === "IDENTITY_GUARD_FAILED") {
    return { eligible: false, deniedReason: "unsafe_failure", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (!isSafeRetryableEarlyFailureReason(input.reasonCode) && classification === "DEVICE_OR_PACKAGE_FAILURE") {
    return { eligible: false, deniedReason: "unsafe_failure", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  if (!isSafeRetryableEarlyFailureReason(input.reasonCode)) {
    return { eligible: false, deniedReason: "failure_not_retryable", classification, reasonCode: input.reasonCode, businessActionsCount };
  }
  return { eligible: true, classification, reasonCode: input.reasonCode, businessActionsCount };
}

export async function loadOriginalSlotAccountSessionRequest(
  supabase: SupabaseLike,
  input: { assignmentId: string; startsAt: string },
) {
  const idempotencyKey = scheduleSessionIdempotencyKey(input.assignmentId, input.startsAt);
  const result = await query(supabase, "account_run_requests")
    .select("id,account_id,status,requested_run_type,run_id,metadata_safe,idempotency_key,completed_at,created_at,error_code,error_message_safe")
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "original_slot_request_lookup_failed");
  const row = (result.data ?? null) as Record<string, unknown> | null;
  if (!row) return null;
  if (readString(row.requested_run_type).toLowerCase() !== "account_session") return null;
  return row;
}

export async function loadControlledRetryRequestForSlot(
  supabase: SupabaseLike,
  input: { assignmentId: string; startsAt: string; retryIndex?: number },
) {
  const retryKey = scheduledSessionControlledRetryIdempotencyKey(
    input.assignmentId,
    input.startsAt,
    input.retryIndex ?? CONTROLLED_RETRY_MAX_INDEX,
  );
  const result = await query(supabase, "account_run_requests")
    .select("id,status,run_id,metadata_safe,idempotency_key,error_code,error_message_safe,cancel_reason")
    .eq("idempotency_key", retryKey)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "controlled_retry_lookup_failed");
  return (result.data ?? null) as Record<string, unknown> | null;
}

export async function loadRunForEarlyFailure(
  supabase: SupabaseLike,
  runId: string | null | undefined,
) {
  const id = readString(runId);
  if (!id) return null;
  const result = await query(supabase, "ig_runs")
    .select("id,status,error_message,total_follow,total_like,total_dm,performance_summary,totals,started_at,finished_at")
    .eq("id", id)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "run_lookup_failed");
  const row = (result.data ?? null) as Record<string, unknown> | null;
  if (!row) return null;
  const performance = readRecord(row.performance_summary);
  return {
    id: readString(row.id),
    status: readString(row.status),
    metadata_safe: {
      ...performance,
      performance_summary: row.performance_summary,
      total_follow: row.total_follow,
      total_like: row.total_like,
      total_dm: row.total_dm,
      totals: row.totals,
      exit_code: readCount(performance.exit_code),
      followers_source_username: readString(performance.followers_source_username) || null,
    },
    exit_code: readCount(performance.exit_code),
  } as Record<string, unknown>;
}

type NotificationChannel = "slack" | "discord";

async function postWebhook(channel: NotificationChannel, webhookUrl: string, body: Record<string, unknown>) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`http_status_${response.status}`);
  }
}

export async function sendScheduledEarlyFailureNotification(input: {
  incidentId: string;
  accountUsername: string;
  message: string;
  severity: "warning" | "critical";
  runId?: string | null;
  requestId?: string | null;
}) {
  let notificationModule: {
    integrationLocalNotificationMode: () => boolean;
    recordNotificationDeliveryResult: (input: {
      channel: NotificationChannel;
      ok: boolean;
      errorRedacted?: string | null;
      test?: boolean;
    }) => Promise<void>;
    resolveEffectiveNotificationChannel: (channel: NotificationChannel) => Promise<{
      sendAllowed: boolean;
      webhookUrl: string;
    }>;
  };
  try {
    notificationModule = await import("./incident-notification-settings.ts");
  } catch {
    return {
      attempted: false,
      slack: "notification_module_unavailable",
      discord: "notification_module_unavailable",
      slack_discord_notified: false,
    };
  }
  const {
    integrationLocalNotificationMode,
    recordNotificationDeliveryResult,
    resolveEffectiveNotificationChannel,
  } = notificationModule;

  const notification = buildCanonicalIncidentNotification({
    title: input.message,
    incidentId: input.incidentId,
    accountUsername: input.accountUsername,
    reason: input.message,
    state: "open",
    severity: input.severity,
    runId: input.runId,
    requestId: input.requestId,
  });

  if (integrationLocalNotificationMode()) {
    return {
      attempted: true,
      slack: "integration_local",
      discord: "integration_local",
      slack_discord_notified: false,
    };
  }

  const deliveries: Record<string, string> = {};
  for (const channel of ["slack", "discord"] as const) {
    const settings = await resolveEffectiveNotificationChannel(channel);
    if (!settings.sendAllowed || !settings.webhookUrl) {
      deliveries[channel] = "skipped_not_configured";
      continue;
    }
    try {
      const body = channel === "discord" ? notification.discordBody : notification.slackBody;
      await postWebhook(channel, settings.webhookUrl, body);
      await recordNotificationDeliveryResult({ channel, ok: true });
      deliveries[channel] = "sent";
    } catch (error) {
      const errorRedacted = error instanceof Error ? error.message : "webhook_request_failed";
      await recordNotificationDeliveryResult({ channel, ok: false, errorRedacted });
      deliveries[channel] = `failed:${errorRedacted}`;
    }
  }

  return {
    attempted: true,
    slack: deliveries.slack ?? "not_attempted",
    discord: deliveries.discord ?? "not_attempted",
    slack_discord_notified: Object.values(deliveries).includes("sent"),
  };
}

async function persistNotificationOutbox(
  supabase: SupabaseLike,
  input: {
    incidentId: string;
    channel: NotificationChannel;
    status: string;
    deliveryKey: string;
    lastError?: string | null;
  },
) {
  const now = new Date().toISOString();
  try {
    await query(supabase, "account_incident_notifications").insert({
      incident_id: input.incidentId,
      channel: input.channel,
      status: input.status,
      target: "redacted",
      delivery_key: input.deliveryKey,
      attempt_count: 1,
      last_attempt_at: now,
      delivered_at: input.status === "sent" ? now : null,
      last_error: input.lastError ?? null,
      payload: { source: "scheduled_early_failure_retry" },
      metadata: { redacted: true, policy: SCHEDULED_EARLY_FAILURE_RETRY_POLICY },
      updated_at: now,
    });
  } catch {
    // Incident persistence must survive notification outbox failures.
  }
}

export async function upsertScheduledEarlyFailureIncident(
  supabase: SupabaseLike,
  input: {
    incidentType: string;
    dedupeKey: string;
    severity: "warning" | "critical";
    status?: "open" | "resolved";
    accountId: string;
    accountUsername: string;
    assignmentId: string;
    runId?: string | null;
    reason: string;
    actionRequired?: string | null;
    adminMessage: string;
    metadata: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc("upsert_account_incident", {
    p_incident_type: input.incidentType,
    p_dedupe_key: input.dedupeKey,
    p_severity: input.severity,
    p_status: input.status ?? "open",
    p_account_id: input.accountId,
    p_account_username: input.accountUsername,
    p_run_id: input.runId ?? null,
    p_assignment_id: input.assignmentId,
    p_source: "scheduled_early_failure_retry",
    p_reason: input.reason,
    p_action_required: input.actionRequired ?? null,
    p_admin_message: input.adminMessage,
    p_metadata: input.metadata,
  });
  if (error) throw new Error(error.message || "scheduled_early_failure_incident_upsert_failed");
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return readString(row?.id) || null;
}

export async function upsertScheduledEarlyFailureDashboardAction(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    incidentId: string | null;
    dedupeKey: string;
    actionType: string;
    status: "pending" | "acknowledged" | "pending_verification";
    severity: "warning" | "critical" | "info";
    title: string;
    adminMessage: string;
    actionLabel: string;
    metadata: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: input.accountId,
    p_client_id: null,
    p_incident_id: input.incidentId,
    p_action_type: input.actionType,
    p_status: input.status,
    p_title: input.title,
    p_dedupe_key: input.dedupeKey,
    p_safe_client_message: null,
    p_admin_message: input.adminMessage,
    p_assistant_message: null,
    p_action_label: input.actionLabel,
    p_action_deep_link: "/instagram-dashboard/incidents",
    p_severity: input.severity,
    p_audience: "admin",
    p_requires_client_action: input.severity === "critical",
    p_blocking_campaign: input.severity === "critical",
    p_metadata: input.metadata,
  });
  if (error) throw new Error(error.message || "scheduled_early_failure_dashboard_action_failed");
  return (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
}

type UpdateCapableBuilder = QueryBuilder & {
  update: (values: Record<string, unknown>) => QueryBuilder;
};

const HANDOFF_REQUEUE_CANCEL_REASONS = new Set([
  "device_lock_missing",
  "preflight_lease_handoff_failed",
  "device_lock_bind_failed",
]);

export function buildControlledRetryHandoffRequeueUpdate(now = new Date()) {
  return {
    status: "queued",
    cancel_reason: null,
    canceled_at: null,
    cancel_requested_at: null,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    run_id: null,
    updated_at: now.toISOString(),
  };
}

export function isQueuedAccountRunRequestClaimEligible(request: {
  status?: string | null;
  cancel_requested_at?: string | null;
}) {
  return readString(request.status).toLowerCase() === "queued"
    && !readString(request.cancel_requested_at);
}

export function detectQueuedCancelRequestedAtConflict(request: {
  status?: string | null;
  cancel_requested_at?: string | null;
}) {
  return readString(request.status).toLowerCase() === "queued"
    && Boolean(readString(request.cancel_requested_at));
}

async function requeueCanceledHandoffFailedRequest(
  supabase: SupabaseLike,
  requestId: string,
  cancelReason?: string | null,
  context?: {
    idempotencyKey?: string | null;
    retryIndex?: number | null;
  },
) {
  const builder = query(supabase, "account_run_requests") as UpdateCapableBuilder;
  let chain = builder
    .update(buildControlledRetryHandoffRequeueUpdate())
    .eq("id", requestId)
    .eq("status", "canceled");
  if (readString(cancelReason)) {
    chain = chain.eq("cancel_reason", readString(cancelReason));
  }
  const result = await chain.select("id,status,idempotency_key") as unknown as QueryResult;
  if (result.error) throw new Error(result.error.message || "controlled_retry_requeue_failed");
  const row = readRows(result.data)[0] ?? null;
  const requeued = Boolean(row && readString(row.status) === "queued");
  if (requeued) {
    console.info("[scheduled_early_failure_retry_requeued]", {
      event: "scheduled_early_failure_retry_requeued",
      request_id: requestId,
      idempotency_key: readString(context?.idempotencyKey) || readString(row?.idempotency_key) || null,
      retry_index: readCount(context?.retryIndex ?? CONTROLLED_RETRY_MAX_INDEX),
      cancel_requested_at_cleared: true,
      cancel_reason: readString(cancelReason) || null,
    });
  }
  return requeued;
}

async function ensureControlledRetryDeviceLease(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    accountId: string;
    appInstanceId?: string | null;
    preflightRequestId: string;
    schedulerRequestId: string;
    workerId: string;
  },
) {
  const pendingWorkerId = pendingManualLockWorkerId(input.schedulerRequestId);
  const handoff = await handoffPreflightLeaseToSchedulerRequest(supabase, {
    deviceId: input.deviceId,
    preflightRequestId: input.preflightRequestId,
    schedulerRequestId: input.schedulerRequestId,
    workerId: pendingWorkerId,
  });
  if (handoff.ok) return { ok: true as const, reason: null };

  const handoffReason = readString(handoff.reason);
  if (handoffReason !== "device_lock_missing") {
    return { ok: false as const, reason: handoffReason || "preflight_lease_handoff_failed" };
  }

  const leaseSeconds = defaultDeviceLockLeaseSeconds();
  const acquire = await acquireDeviceSessionLock(supabase, {
    deviceId: input.deviceId,
    workerId: pendingWorkerId,
    accountId: input.accountId,
    appInstanceId: input.appInstanceId ?? null,
    leaseSeconds,
    reason: "scheduler_run",
    ownerKind: "scheduler",
    operationPhase: "queued",
  });
  if (!acquire.ok) {
    return { ok: false as const, reason: acquire.reason || "device_lease_unavailable" };
  }

  const bind = await bindDeviceSessionLockToRequest(supabase, {
    deviceId: input.deviceId,
    workerId: pendingWorkerId,
    requestId: input.schedulerRequestId,
    leaseSeconds,
  });
  if (!bind.ok) {
    return { ok: false as const, reason: bind.reason || "device_lock_bind_failed" };
  }

  return { ok: true as const, reason: null };
}

export async function enqueueScheduledEarlyFailureRetry(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    startsAt: string;
    endsAt: string;
    workerId: string;
    deviceId: string;
    appInstanceId?: string | null;
    deviceTimezone: string | null;
    preflightId: string;
    preflightRequestId: string;
    originalRequestId: string;
    originalRunId: string | null;
    retryReason: string;
    incidentId: string;
    extraMetadata?: Record<string, unknown>;
  },
) {
  const idempotencyKey = scheduledSessionControlledRetryIdempotencyKey(input.assignmentId, input.startsAt);
  const existingRetry = await loadControlledRetryRequestForSlot(supabase, {
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
  });
  const existingStatus = readString(existingRetry?.status).toLowerCase();
  const existingId = readString(existingRetry?.id);
  const existingCancelReason = readString(existingRetry?.cancel_reason);

  if (
    existingId
    && existingStatus === "canceled"
    && HANDOFF_REQUEUE_CANCEL_REASONS.has(existingCancelReason)
  ) {
    const lease = await ensureControlledRetryDeviceLease(supabase, {
      deviceId: input.deviceId,
      accountId: input.accountId,
      appInstanceId: input.appInstanceId ?? null,
      preflightRequestId: input.preflightRequestId,
      schedulerRequestId: existingId,
      workerId: input.workerId,
    });
    if (!lease.ok) {
      return { ok: false as const, reason: lease.reason || "controlled_retry_requeue_failed", requestId: existingId, idempotencyKey };
    }
    const requeued = await requeueCanceledHandoffFailedRequest(supabase, existingId, existingCancelReason, {
      idempotencyKey,
      retryIndex: CONTROLLED_RETRY_MAX_INDEX,
    });
    if (!requeued) {
      return { ok: false as const, reason: "controlled_retry_requeue_failed", requestId: existingId, idempotencyKey };
    }
    return {
      ok: true as const,
      requestId: existingId,
      idempotencyKey,
      requestStatus: "queued",
      requeued: true,
    };
  }

  const metadata = {
    ...buildSchedulerSessionMetadata({
      assignmentId: input.assignmentId,
      workerId: input.workerId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      deviceTimezone: input.deviceTimezone,
      preflightId: input.preflightId,
    }),
    controlled_retry: true,
    retry_index: CONTROLLED_RETRY_MAX_INDEX,
    retry_reason: input.retryReason,
    retry_policy: SCHEDULED_EARLY_FAILURE_RETRY_POLICY,
    original_request_id: input.originalRequestId,
    original_run_id: input.originalRunId,
    incident_id: input.incidentId,
    liam_policy: "scheduled_early_failure_retry",
    applies_to_all_scheduled_accounts: true,
    ...(input.extraMetadata ?? {}),
  };

  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: input.accountId,
    p_requested_by: null,
    p_actor_type: "system",
    p_source_surface: "instagram_schedule_session_cron",
    p_requested_run_type: "account_session",
    p_idempotency_key: idempotencyKey,
    p_priority: 0,
    p_metadata_safe: metadata,
  });
  if (error) throw new Error(error.message || "scheduled_early_failure_retry_enqueue_failed");
  const requestRow = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const requestId = readString(requestRow?.id, "");
  if (!requestId) throw new Error("scheduled_early_failure_retry_request_missing");

  const lease = await ensureControlledRetryDeviceLease(supabase, {
    deviceId: input.deviceId,
    accountId: input.accountId,
    appInstanceId: input.appInstanceId ?? null,
    preflightRequestId: input.preflightRequestId,
    schedulerRequestId: requestId,
    workerId: input.workerId,
  });
  if (!lease.ok) {
    await supabase.rpc("cancel_account_run_request", {
      p_request_id: requestId,
      p_reason: lease.reason || "preflight_lease_handoff_failed",
    });
    throw new Error(lease.reason || "preflight_lease_handoff_failed");
  }

  return { ok: true as const, requestId, idempotencyKey, requestStatus: readString(requestRow?.status) || null, requeued: false };
}

export type ScheduledEarlyFailureRetryOutcome =
  | { action: "none" }
  | { action: "retry_queued"; requestId: string; idempotencyKey: string; incidentId: string; notificationStatus: Record<string, string>; requeued?: boolean }
  | { action: "blocked_unsafe"; incidentId: string; deniedReason: string; notificationStatus: Record<string, string> }
  | { action: "blocked_already_retried"; incidentId?: string | null; deniedReason: string }
  | { action: "blocked_retry_in_flight"; retryRequestId: string }
  | { action: "blocked_not_retryable"; deniedReason: string };

export async function evaluateAndMaybeEnqueueScheduledEarlyFailureRetry(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    accountUsername: string;
    assignmentId: string;
    startsAt: string;
    endsAt: string;
    workerId: string;
    deviceId: string;
    appInstanceId?: string | null;
    deviceTimezone: string | null;
    preflightId: string;
    preflightRequestId: string;
    preflightStatus: string;
    now?: Date;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<ScheduledEarlyFailureRetryOutcome> {
  const now = input.now ?? new Date();
  const transition = deriveAssignmentTransitionTimestamps(input.startsAt, input.endsAt);

  const originalRequest = await loadOriginalSlotAccountSessionRequest(supabase, {
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
  });
  if (!originalRequest) return { action: "none" };

  const originalStatus = readString(originalRequest.status).toLowerCase();
  if (!["failed", "canceled", "cancelled"].includes(originalStatus)) {
    return { action: "none" };
  }

  const retryRequest = await loadControlledRetryRequestForSlot(supabase, {
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
  });
  const retryStatus = readString(retryRequest?.status).toLowerCase();
  const retryCancelReason = readString(retryRequest?.cancel_reason);
  const retryHandoffRequeueable = retryStatus === "canceled"
    && HANDOFF_REQUEUE_CANCEL_REASONS.has(retryCancelReason);
  if (retryRequest && ACTIVE_REQUEST_STATUSES.has(retryStatus)) {
    return { action: "blocked_retry_in_flight", retryRequestId: readString(retryRequest.id) };
  }

  const run = await loadRunForEarlyFailure(supabase, readString(originalRequest.run_id) || null);
  const reasonCode = resolveEarlyFailureReasonCode({
    requestReasonCode: readString(originalRequest.reason_code) || null,
    requestErrorCode: readString(originalRequest.error_code) || null,
    runMetadata: run?.metadata_safe,
    exitCode: readCount(run?.exit_code),
  });
  const businessActionsCount = countBusinessActionsFromRunMetadata(run?.metadata_safe);

  const eligibility = evaluateScheduledEarlyFailureRetryEligibility({
    now,
    transition,
    preflightStatus: input.preflightStatus,
    originalRequestStatus: originalStatus,
    reasonCode,
    businessActionsCount,
    retryAlreadyExists: Boolean(retryRequest) && !retryHandoffRequeueable,
    retryInFlight: Boolean(retryRequest && ACTIVE_REQUEST_STATUSES.has(retryStatus)),
    retryFailedTerminal: Boolean(
      retryRequest
      && ["failed", "canceled", "cancelled"].includes(retryStatus)
      && !retryHandoffRequeueable,
    ),
  });

  const originalRequestId = readString(originalRequest.id);
  const originalRunId = readString(originalRequest.run_id) || readString(run?.id) || null;
  const incidentDedupeKey = scheduledEarlyFailureIncidentDedupeKey({
    accountId: input.accountId,
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
    originalRequestId,
  });
  const dashboardDedupeKey = scheduledEarlyFailureDashboardActionDedupeKey({
    accountId: input.accountId,
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
  });

  const baseMetadata = {
    controlled_retry: true,
    retry_index: CONTROLLED_RETRY_MAX_INDEX,
    retry_policy: SCHEDULED_EARLY_FAILURE_RETRY_POLICY,
    liam_policy: "scheduled_early_failure_retry",
    applies_to_all_scheduled_accounts: true,
    account_id: input.accountId,
    username: input.accountUsername,
    assignment_id: input.assignmentId,
    scheduled_window_start: input.startsAt,
    scheduled_window_end: input.endsAt,
    business_action_deadline: transition?.business_action_deadline ?? null,
    original_request_id: originalRequestId,
    original_run_id: originalRunId,
    original_exit_code: readCount(run?.exit_code),
    original_failure_stage: "before_target_entry",
    original_reason_code: reasonCode,
    business_actions_count: businessActionsCount,
    retry_eligible: eligibility.eligible,
    retry_denied_reason: eligibility.eligible ? null : ("deniedReason" in eligibility ? eligibility.deniedReason : null),
    failure_classification: eligibility.classification,
    target_source_account: readString(readRecord(run?.metadata_safe).followers_source_username) || null,
  };

  if (!eligibility.eligible) {
    if (eligibility.deniedReason === "controlled_retry_already_consumed" && retryRequest) {
      if (["failed", "canceled", "cancelled"].includes(retryStatus)) {
        const incidentId = await upsertScheduledEarlyFailureIncident(supabase, {
          incidentType: INCIDENT_TYPE_RETRY_FAILED,
          dedupeKey: `${incidentDedupeKey}:retry_failed`,
          severity: "critical",
          accountId: input.accountId,
          accountUsername: input.accountUsername,
          assignmentId: input.assignmentId,
          runId: readString(retryRequest.run_id) || originalRunId,
          reason: "scheduled_retry_failed",
          actionRequired: "operator_review_required",
          adminMessage: "Scheduled run failed again after controlled retry.",
          metadata: {
            ...baseMetadata,
            needs_operator_review: true,
            retry_request_id: readString(retryRequest.id),
            retry_run_id: readString(retryRequest.run_id) || null,
          },
        });
        await sendScheduledEarlyFailureNotification({
          incidentId: incidentId || randomUUID(),
          accountUsername: input.accountUsername,
          message: "Scheduled run failed again after controlled retry",
          severity: "critical",
        });
        const operatorReviewAction = await upsertScheduledEarlyFailureDashboardAction(supabase, {
          accountId: input.accountId,
          incidentId,
          dedupeKey: dashboardDedupeKey,
          actionType: DASHBOARD_ACTION_TYPE_OPERATOR_REVIEW,
          status: "pending_verification",
          severity: "critical",
          title: "Scheduled retry failed — operator review required",
          adminMessage: `Controlled retry failed for @${input.accountUsername}. Reason: ${reasonCode}.`,
          actionLabel: "Review scheduled retry failure",
          metadata: { ...baseMetadata, incident_id: incidentId, needs_operator_review: true },
        });
        if (incidentId && readString(operatorReviewAction?.id)) {
          await deliverOperatorReviewNotifications({
            event: "created",
            actionId: readString(operatorReviewAction?.id),
            incidentId,
            accountId: input.accountId,
            accountUsername: input.accountUsername,
            reason: reasonCode,
            finalStatus: "pending_verification",
            operatorId: "system",
          }, { supabase });
        }
        return {
          action: "blocked_already_retried",
          incidentId,
          deniedReason: eligibility.deniedReason,
        };
      }
      return { action: "blocked_already_retried", deniedReason: eligibility.deniedReason };
    }

    if (["unsafe_failure", "business_action_already_performed", "deadline_expired"].includes(eligibility.deniedReason)) {
      const incidentId = await upsertScheduledEarlyFailureIncident(supabase, {
        incidentType: INCIDENT_TYPE_UNSAFE_NO_RETRY,
        dedupeKey: `${incidentDedupeKey}:unsafe`,
        severity: "critical",
        accountId: input.accountId,
        accountUsername: input.accountUsername,
        assignmentId: input.assignmentId,
        runId: originalRunId,
        reason: eligibility.deniedReason,
        actionRequired: "operator_review_required",
        adminMessage: `Scheduled run failed without safe retry: ${eligibility.deniedReason}.`,
        metadata: { ...baseMetadata, needs_operator_review: true },
      });
      const notification = await sendScheduledEarlyFailureNotification({
        incidentId: incidentId || randomUUID(),
        accountUsername: input.accountUsername,
        message: `Scheduled run failed — no safe retry (${eligibility.deniedReason})`,
        severity: "critical",
      });
      const operatorReviewAction = await upsertScheduledEarlyFailureDashboardAction(supabase, {
        accountId: input.accountId,
        incidentId,
        dedupeKey: dashboardDedupeKey,
        actionType: DASHBOARD_ACTION_TYPE_OPERATOR_REVIEW,
        status: "pending_verification",
        severity: "critical",
        title: "Scheduled run failed — no safe retry",
        adminMessage: `No controlled retry for @${input.accountUsername}: ${eligibility.deniedReason}.`,
        actionLabel: "Review unsafe scheduled failure",
        metadata: { ...baseMetadata, incident_id: incidentId, needs_operator_review: true },
      });
      if (incidentId && readString(operatorReviewAction?.id)) {
          await deliverOperatorReviewNotifications({
          event: "created",
          actionId: readString(operatorReviewAction?.id),
          incidentId,
          accountId: input.accountId,
          accountUsername: input.accountUsername,
          reason: eligibility.deniedReason,
          finalStatus: "pending_verification",
            operatorId: "system",
          }, { supabase });
      }
      return {
        action: "blocked_unsafe",
        incidentId: incidentId || "",
        deniedReason: eligibility.deniedReason,
        notificationStatus: {
          slack: String(notification.slack),
          discord: String(notification.discord),
        },
      };
    }

    return { action: "blocked_not_retryable", deniedReason: eligibility.deniedReason };
  }

  const incidentId = await upsertScheduledEarlyFailureIncident(supabase, {
    incidentType: INCIDENT_TYPE_EARLY_FAILURE_RETRYING,
    dedupeKey: incidentDedupeKey,
    severity: "warning",
    accountId: input.accountId,
    accountUsername: input.accountUsername,
    assignmentId: input.assignmentId,
    runId: originalRunId,
    reason: reasonCode,
    actionRequired: "monitor_controlled_retry",
    adminMessage: "Scheduled run failed early; one controlled retry will be attempted.",
    metadata: {
      ...baseMetadata,
      retry_reason: reasonCode,
      slack_discord_notified: false,
    },
  });

  const notification = await sendScheduledEarlyFailureNotification({
    incidentId: incidentId || randomUUID(),
    accountUsername: input.accountUsername,
    message: "Scheduled run failed early; one controlled retry will be attempted",
    severity: "warning",
  });

  for (const channel of ["slack", "discord"] as const) {
    const status = channel === "slack" ? String(notification.slack) : String(notification.discord);
    if (status === "skipped_not_configured" || status === "integration_local" || status === "not_attempted") continue;
    await persistNotificationOutbox(supabase, {
      incidentId: incidentId || randomUUID(),
      channel,
      status: status.startsWith("failed") ? "failed" : "sent",
      deliveryKey: `${channel}:${incidentId}:scheduled_early_failure_retry`,
      lastError: status.startsWith("failed") ? status : null,
    });
  }

  await upsertScheduledEarlyFailureDashboardAction(supabase, {
    accountId: input.accountId,
    incidentId,
    dedupeKey: dashboardDedupeKey,
    actionType: DASHBOARD_ACTION_TYPE_EARLY_RETRY,
    status: "acknowledged",
    severity: "warning",
    title: "Scheduled early failure — controlled retry",
    adminMessage: `Early scheduled failure for @${input.accountUsername}. Controlled retry #1 queued.`,
    actionLabel: "Monitor controlled retry",
    metadata: {
      ...baseMetadata,
      incident_id: incidentId,
      slack_discord_notified: notification.slack_discord_notified,
      notification_status_slack: String(notification.slack),
      notification_status_discord: String(notification.discord),
    },
  });

  const enqueue = await enqueueScheduledEarlyFailureRetry(supabase, {
    accountId: input.accountId,
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    workerId: input.workerId,
    deviceId: input.deviceId,
    appInstanceId: input.appInstanceId ?? null,
    deviceTimezone: input.deviceTimezone,
    preflightId: input.preflightId,
    preflightRequestId: input.preflightRequestId,
    originalRequestId,
    originalRunId,
    retryReason: reasonCode,
    incidentId: incidentId || "",
    extraMetadata: input.extraMetadata,
  });

  if (!enqueue.ok) {
    return {
      action: "blocked_not_retryable",
      deniedReason: enqueue.reason || "controlled_retry_enqueue_failed",
    };
  }

  return {
    action: "retry_queued",
    requestId: enqueue.requestId,
    idempotencyKey: enqueue.idempotencyKey,
    incidentId: incidentId || "",
    notificationStatus: {
      slack: String(notification.slack),
      discord: String(notification.discord),
    },
    requeued: enqueue.requeued === true,
  };
}
