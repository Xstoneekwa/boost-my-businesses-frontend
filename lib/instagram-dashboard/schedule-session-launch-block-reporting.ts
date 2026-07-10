import {
  integrationLocalNotificationMode,
  resolveEffectiveNotificationChannel,
  type NotificationChannel,
} from "./incident-notification-settings.ts";
import { normalizeSchedulerReason } from "./scheduler-reasons.ts";

export const SCHEDULER_LAUNCH_BLOCK_ACTION_TYPE = "scheduler_launch_blocked";

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "cookie",
  "webhook",
  "serial",
  "package",
  "clone",
  "device_id",
  "app_instance_id",
  "verification_code",
]);

/** Config / technical / human-intervention blocks worth operator signal. */
export const REPORTABLE_SCHEDULER_LAUNCH_BLOCK_REASONS = new Set([
  "welcome_real_send_disabled",
  "outreach_real_send_disabled",
  "welcome_template_missing",
  "outreach_template_missing",
  "dm_legacy_gate_mismatch",
  "credentials_review_required",
  "login_verification_required",
  "identity_mismatch_review_required",
  "account_blocking_action_or_credentials",
  "dispatcher_launch_disabled",
  "dispatcher_unavailable",
  "dispatcher_health_read_failed",
  "eligibility_query_failed",
  "late_preflight_blocked",
  "late_preflight_retry_cap_exceeded",
  "enqueue_failed",
  "preflight_lease_handoff_failed",
  "cron_token_not_configured",
  "technical_disabled",
]);

export const SCHEDULER_LAUNCH_BLOCK_OPERATOR_COPY: Record<string, {
  adminMessage: string;
  clientMessage: string;
  actionHint: string;
}> = {
  welcome_real_send_disabled: {
    adminMessage: "Daily Scheduler blocked: Welcome DM real send is disabled in production config.",
    clientMessage: "Scheduled session launch is paused until Welcome DM production config is enabled.",
    actionHint: "Enable WELCOME_DM_REAL_SEND_ENABLED in production or disable Welcome DM for this account.",
  },
  outreach_real_send_disabled: {
    adminMessage: "Daily Scheduler blocked: Outreach DM real send is disabled in production config.",
    clientMessage: "Scheduled session launch is paused until Outreach DM production config is enabled.",
    actionHint: "Enable OUTREACH_DM_REAL_SEND_ENABLED in production or disable Outreach DM for this account.",
  },
  credentials_review_required: {
    adminMessage: "Daily Scheduler blocked: credentials review is required.",
    clientMessage: "Scheduled session launch is paused until credentials are reviewed.",
    actionHint: "Review credentials in the admin dashboard.",
  },
  login_verification_required: {
    adminMessage: "Daily Scheduler blocked: login verification is required.",
    clientMessage: "Scheduled session launch is paused until login verification completes.",
    actionHint: "Complete login verification for this account.",
  },
  identity_mismatch_review_required: {
    adminMessage: "Daily Scheduler blocked: identity mismatch review is required.",
    clientMessage: "Scheduled session launch is paused until identity mismatch is resolved.",
    actionHint: "Review the account mismatch in Incidents/Actions.",
  },
  late_preflight_blocked: {
    adminMessage: "Daily Scheduler blocked: scheduled session preflight failed and needs operator review.",
    clientMessage: "Scheduled session launch is paused until preflight is cleared.",
    actionHint: "Review preflight status and resolve the blocking reason.",
  },
  late_preflight_retry_cap_exceeded: {
    adminMessage: "Daily Scheduler blocked: late preflight retry cap exceeded for this session window.",
    clientMessage: "Scheduled session launch is paused for this window after repeated preflight retries.",
    actionHint: "Review why preflight keeps failing before the next session window; no further automatic retries will run in this window.",
  },
  dispatcher_launch_disabled: {
    adminMessage: "Daily Scheduler blocked: dispatcher launch is disabled.",
    clientMessage: "Scheduled session launch is paused until dispatcher launch is enabled.",
    actionHint: "Enable dispatcher launch in run-control configuration.",
  },
  dispatcher_unavailable: {
    adminMessage: "Daily Scheduler blocked: dispatcher is unavailable.",
    clientMessage: "Scheduled session launch is paused until the dispatcher is healthy.",
    actionHint: "Restore dispatcher health and confirm launch is enabled.",
  },
  eligibility_query_failed: {
    adminMessage: "Daily Scheduler blocked: eligibility could not be evaluated.",
    clientMessage: "Scheduled session launch is paused due to a technical eligibility read failure.",
    actionHint: "Check backend logs and restore eligibility data sources.",
  },
  enqueue_failed: {
    adminMessage: "Daily Scheduler blocked: run request enqueue failed.",
    clientMessage: "Scheduled session launch is paused due to a technical enqueue failure.",
    actionHint: "Inspect run-control enqueue errors for this account.",
  },
};

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function dashboardBaseUrl() {
  const base = String(process.env.INCIDENT_NOTIFICATIONS_DASHBOARD_BASE_URL || "").trim().replace(/\/$/, "");
  if (base) return base;
  const vercel = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!vercel) return "";
  return vercel.startsWith("http") ? vercel.replace(/\/$/, "") : `https://${vercel.replace(/\/$/, "")}`;
}

function redactPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactPayload);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowered) || lowered.includes("password") || lowered.includes("code")) {
      continue;
    }
    out[key] = redactPayload(child);
  }
  return out;
}

export function shouldReportSchedulerLaunchBlock(reason: string) {
  const normalized = normalizeSchedulerReason(reason);
  return REPORTABLE_SCHEDULER_LAUNCH_BLOCK_REASONS.has(normalized.code);
}

export function schedulerLaunchBlockDedupeKey(input: {
  accountId: string;
  assignmentId: string;
  startsAt: string;
  reasonCode: string;
}) {
  return `account:${input.accountId}:scheduler_launch_block:${input.reasonCode}:${input.assignmentId}:${input.startsAt}`;
}

function operatorCopy(reasonCode: string) {
  const copy = SCHEDULER_LAUNCH_BLOCK_OPERATOR_COPY[reasonCode];
  if (copy) return copy;
  const normalized = normalizeSchedulerReason(reasonCode);
  return {
    adminMessage: `Daily Scheduler blocked: ${normalized.label}.`,
    clientMessage: "Scheduled session launch is paused until the blocking reason is resolved.",
    actionHint: `Resolve scheduler block: ${normalized.label}.`,
  };
}

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

async function loadExistingActionByDedupe(supabase: SupabaseLike, dedupeKey: string) {
  const result = await (supabase.from("account_dashboard_actions") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        limit: (count: number) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
      };
    };
  })
    .select("id,status")
    .eq("dedupe_key", dedupeKey)
    .limit(1);
  if (result.error) return null;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

export async function sendSchedulerLaunchBlockNotification(input: {
  accountUsername: string;
  reasonCode: string;
  actionDeepLink: string;
}) {
  if (process.env.SCHEDULER_LAUNCH_BLOCK_NOTIFICATIONS_ENABLED === "false") {
    return { skipped: true, reason: "disabled" };
  }

  const copy = operatorCopy(input.reasonCode);
  const base = dashboardBaseUrl();
  const secureUrl = base
    ? `${base}${input.actionDeepLink.startsWith("/") ? input.actionDeepLink : `/${input.actionDeepLink}`}`
    : input.actionDeepLink;

  const text = [
    "Scheduler launch blocked",
    `Account: @${input.accountUsername}`,
    `Reason: ${copy.adminMessage}`,
    `Action: ${copy.actionHint}`,
    secureUrl,
  ].join("\n");

  const payload = redactPayload({
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "*Scheduler launch blocked*" } },
      { type: "section", text: { type: "mrkdwn", text: `Account: @${input.accountUsername}` } },
      { type: "section", text: { type: "mrkdwn", text: `Reason: ${copy.adminMessage}` } },
      { type: "section", text: { type: "mrkdwn", text: `Action: ${copy.actionHint}` } },
      { type: "section", text: { type: "mrkdwn", text: `<${secureUrl}|Open Incidents/Actions>` } },
    ],
  }) as Record<string, unknown>;

  if (integrationLocalNotificationMode()) {
    return { skipped: true, reason: "integration_local", payload };
  }

  const channels: NotificationChannel[] = ["slack", "discord"];
  const deliveries: Array<{ channel: NotificationChannel; status: string }> = [];

  for (const channel of channels) {
    const settings = await resolveEffectiveNotificationChannel(channel);
    if (!settings.sendAllowed || !settings.webhookUrl) {
      deliveries.push({ channel, status: "skipped_not_configured" });
      continue;
    }
    try {
      const body = channel === "discord" ? { content: text } : payload;
      await postWebhook(channel, settings.webhookUrl, body);
      deliveries.push({ channel, status: "sent" });
    } catch (error) {
      deliveries.push({
        channel,
        status: `failed:${error instanceof Error ? error.message : "unknown"}`,
      });
    }
  }

  return { skipped: false, deliveries };
}

export async function reportSchedulerLaunchBlock(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    username?: string | null;
  },
): Promise<{ reported: boolean; reason?: string; notified?: boolean }> {
  const normalized = normalizeSchedulerReason(input.reason);
  if (!shouldReportSchedulerLaunchBlock(normalized.code)) {
    return { reported: false, reason: "not_reportable" };
  }

  const dedupeKey = schedulerLaunchBlockDedupeKey({
    accountId: input.accountId,
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
    reasonCode: normalized.code,
  });
  const existing = await loadExistingActionByDedupe(supabase, dedupeKey);
  const copy = operatorCopy(normalized.code);
  const username = readString(input.username) || "unknown";

  const { error } = await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: input.accountId,
    p_client_id: null,
    p_incident_id: null,
    p_action_type: SCHEDULER_LAUNCH_BLOCK_ACTION_TYPE,
    p_status: "pending",
    p_title: "Scheduler launch blocked",
    p_dedupe_key: dedupeKey,
    p_safe_client_message: copy.clientMessage,
    p_admin_message: copy.adminMessage,
    p_assistant_message: copy.actionHint,
    p_action_label: "Review",
    p_action_deep_link: "/instagram-dashboard/incidents",
    p_severity: "warning",
    p_audience: "admin",
    p_requires_client_action: false,
    p_blocking_campaign: true,
    p_metadata: {
      source: "schedule_session_cron",
      reason_code: normalized.code,
      reason_raw: normalized.raw,
      assignment_id: input.assignmentId,
      scheduled_window_start: input.startsAt,
      scheduled_window_end: input.endsAt,
      username,
    },
  });
  if (error) {
    return { reported: false, reason: error.message || "upsert_failed" };
  }

  let notified = false;
  if (!existing) {
    const notification = await sendSchedulerLaunchBlockNotification({
      accountUsername: username,
      reasonCode: normalized.code,
      actionDeepLink: "/instagram-dashboard/incidents",
    });
    notified = notification.skipped === false;
  }

  return { reported: true, notified };
}
