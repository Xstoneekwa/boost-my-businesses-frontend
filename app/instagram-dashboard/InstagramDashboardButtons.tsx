"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, BarChart3, Clipboard, Download, FileText, Funnel, Play, RotateCcw, Settings, Square, Trash2, Users, type LucideIcon } from "lucide-react";
import { DM_TEMPLATE_MESSAGE_MAX_CHARS, dmTemplateLengthError, dmTemplateLineCount, normalizeDmTemplateMessage } from "@/lib/instagram-dashboard/dm-formatting";
import type { ScheduleProjection, ScheduleSlotProjection } from "@/lib/instagram-dashboard/schedule";
import {
  buildTargetsOverview,
  isArchivedOrDeletedTarget,
  isValidEligibleTarget,
  targetFbrLabel,
  type TargetAccountItem,
  type TargetSafeRow,
  type TargetsOverview,
} from "./targets-data";
import InstagramAccountTargetsPanel from "./InstagramAccountTargetsPanel";

type InstagramDashboardButtonsProps = {
  accountId: string;
  username: string;
  mode?: "active" | "archived" | "trashed";
  packageLabel?: string | null;
  entitlementSummary?: string | null;
};

type ConfigValue = string | number | boolean;
type InstagramSettings = Record<string, ConfigValue> & { account_id: string };
type InstagramFilters = Record<string, ConfigValue> & { account_id: string };

type FollowFiltersProjection = {
  account_id: string;
  skip_private_profiles: boolean;
  min_followers: number | null;
  max_followers: number | null;
  min_posts: number | null;
  runtime_ready_fields: string[];
  planned_fields: string[];
  runtime_status: "active";
  save_ready: boolean;
  changed_fields?: string[];
};
type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
type AccountTemplate = Record<string, unknown> & {
  id: string;
  name: string;
  description?: string | null;
  template_type: "settings" | "filters" | "full";
  is_default?: boolean;
};

type DmDomainProjection = {
  account_id: string;
  welcome_service_active: boolean;
  outreach_service_active: boolean;
  welcome_entitlement_status: string;
  outreach_entitlement_status: string;
  welcome_enabled: boolean;
  outreach_enabled: boolean;
  welcome_message: string;
  outreach_message: string;
  welcome_template_status: string;
  outreach_template_status: string;
  welcome_cap_session: number;
  welcome_cap_day: number;
  outreach_cap_session: number;
  outreach_cap_day: number;
  welcome_real_send_status: string;
  outreach_real_send_status: string;
  legacy_dm_gate_status: string;
  save_ready: boolean;
  validation_error?: string | null;
  changed_fields?: string[];
};

type UnfollowDomainProjection = {
  account_id: string;
  unfollow_enabled: boolean;
  unfollow_mode: string;
  unfollow_per_session_limit: number;
  unfollow_per_day_limit: number;
  unfollow_after_days: number;
  effective_unfollow_cap: number;
  runtime_safety_cap: number | null;
  runtime_hard_cap: number;
  unfollow_day_remaining: number | null;
  limiting_reason: string;
  runtime_cap_mode: string;
  runtime_cap_source: string;
  follow_entitlement_status: string;
  unfollow_entitlement_status: string;
  current_runtime_mode: string;
  handoff_real_status: string;
  block_reason: string;
  safe_candidate_strategy_status: string;
  do_unfollow_first_status: string;
  changed_fields?: string[];
};

type StatsRow = {
  id: string;
  worker_type?: string;
  status?: string;
  created_at?: string;
  last_run_at?: string;
  latest_target_username?: string;
  session_time: string;
  followers: number;
  followings: number;
  follow_back_enabled: boolean;
  like_back_enabled: boolean;
  follow: number;
  unfollow: number;
  like: number;
  comment: number;
  dm: number;
  watch: number;
  total_interactions: number;
  total_ms?: number;
  typing_command_ms?: number;
  row_detect_ms?: number;
  row_tap_command_ms?: number;
  profile_transition_wait_ms?: number;
  profile_verify_ms?: number;
  warm_session_used?: boolean;
  force_stop_used?: boolean;
  xml_fetches?: number;
  recovery_used?: boolean;
  exit_code?: string;
};

type LogRow = {
  id: string;
  account_id: string;
  created_at: string;
  run_id: string;
  target_username: string;
  action_type: string;
  status: string;
  message: string;
  worker_type?: string;
  payload?: unknown;
  performance_summary?: unknown;
  metadata?: unknown;
};

type Panel = "settings" | "stats" | "logs" | "filters" | null;
type SettingsTab = "General" | "Schedule" | "Follow" | "DM" | "Followback" | "Sources" | "Filters" | "Safety" | "Advanced";
type VisibleSettingsTab = Exclude<SettingsTab, "Advanced">;
type DisplayedSettingsTab = Exclude<VisibleSettingsTab, "Safety">;
type FieldType = "text" | "password" | "time" | "date" | "number" | "toggle" | "textarea" | "select";
type RuntimeStatus = "active" | "needs-routing" | "read-only" | "ops-only" | "deprecated";

type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  helper?: string;
  readOnly?: boolean;
  disabled?: boolean;
  runtimeStatus?: RuntimeStatus;
  options?: string[];
  disabledOptions?: string[];
  optionLabels?: Record<string, string>;
  min?: number;
  step?: number;
  hideStateText?: boolean;
  hideHelper?: boolean;
};

export type DmServiceDisabledReason =
  | "not_included_in_package"
  | "add_on_not_active"
  | "entitlement_missing"
  | "domain_api_pending";

export type DmServiceAvailability = {
  welcomeServiceActive: boolean;
  outreachServiceActive: boolean;
  welcomeDisabledReason: DmServiceDisabledReason | null;
  outreachDisabledReason: DmServiceDisabledReason | null;
};

type AccountTool = {
  label:
    | "Stats"
    | "Logs"
    | "Run manually"
    | "Stop run"
    | "Settings"
    | "Filters"
    | "Targets"
    | "Archive"
    | "Move to trash"
    | "Restore account"
    | "Permanent delete";
  Icon: LucideIcon;
  tone?: "success" | "neutral" | "danger";
  disabled?: boolean;
  disabledReason?: string;
};

const DRAFT_SETTINGS_BANNER =
  "Dashboard draft settings. Saved values persist to the dashboard DB; fields marked Needs routing are not runtime-active until Phone Farm domain wiring is complete.";

const FILTERS_PRODUCTION_BANNER =
  "Follow filters apply before the worker attempts a follow. Legacy draft filters are hidden.";

type Confirmation = {
  title: string;
  description: string;
  confirmTone: "primary" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
};
type TemplateDialog = { kind: "save" | "apply"; source: "settings" | "filters" } | null;
type ExportMenu = "stats" | "logs" | null;
type LogExportScope = "all" | "latest-run" | "latest-python-run";

type RunControlHealth = {
  healthy: boolean;
  playEnabled: boolean;
  reason: string;
};

type RunStartResponse = {
  started?: boolean;
  idempotent?: boolean;
  message?: string;
  account_id?: string;
  request_id?: string;
  status?: string;
};

const DEFAULT_WELCOME_DM_DAY_CAP = 10;
const DEFAULT_OUTREACH_DM_DAY_CAP = 30;

export function runStartSuccessMessage(payload: RunStartResponse) {
  if (!payload.request_id || !payload.status) {
    throw new Error("Run start did not return a request id.");
  }
  return payload.message || `Run request ${payload.request_id.slice(0, 8)} queued (${payload.status}).`;
}

const baseActiveAccountTools: AccountTool[] = [
  { label: "Stats", Icon: BarChart3 },
  { label: "Logs", Icon: FileText },
  {
    label: "Run manually",
    Icon: Play,
    tone: "success",
  },
  { label: "Stop run", Icon: Square, tone: "danger" },
  { label: "Settings", Icon: Settings, tone: "neutral" },
  { label: "Filters", Icon: Funnel },
  { label: "Targets", Icon: Users, tone: "neutral" },
  { label: "Archive", Icon: Archive },
  { label: "Move to trash", Icon: Trash2, tone: "danger" },
];

function buildActiveAccountTools(health: RunControlHealth | null, isStartingRun: boolean): AccountTool[] {
  const playDisabled = isStartingRun || !health?.playEnabled || !health?.healthy;
  const playDisabledReason = isStartingRun
    ? "Starting run..."
    : !health?.playEnabled
      ? "Manual run requires runtime consumer."
      : !health?.healthy
        ? "Manual run requires a healthy runtime dispatcher."
        : undefined;

  return baseActiveAccountTools.map((tool) => {
    if (tool.label !== "Run manually") return tool;
    return {
      ...tool,
      disabled: playDisabled,
      disabledReason: playDisabledReason,
    };
  });
}

const archivedAccountTools: AccountTool[] = [
  { label: "Stats", Icon: BarChart3 },
  { label: "Logs", Icon: FileText },
  { label: "Settings", Icon: Settings, tone: "neutral" },
  { label: "Targets", Icon: Users, tone: "neutral" },
  { label: "Restore account", Icon: RotateCcw, tone: "success" },
  { label: "Move to trash", Icon: Trash2, tone: "danger" },
];

const trashedAccountTools: AccountTool[] = [
  { label: "Stats", Icon: BarChart3 },
  { label: "Logs", Icon: FileText },
  { label: "Targets", Icon: Users, tone: "neutral" },
  { label: "Restore account", Icon: RotateCcw, tone: "success" },
  { label: "Permanent delete", Icon: Trash2, tone: "danger", disabled: true },
];

const settingsTabs: DisplayedSettingsTab[] = ["General", "Schedule", "Follow", "DM", "Followback", "Sources", "Filters"];

function visibleSettingsTab(tab: SettingsTab): DisplayedSettingsTab {
  return settingsTabs.some((visibleTab) => visibleTab === tab) ? (tab as DisplayedSettingsTab) : "General";
}

const settingsFields: Record<Exclude<VisibleSettingsTab, "Filters">, FieldSpec[]> = {
  General: [],
  Schedule: [],
  Follow: [
    { key: "commercial_package_label", label: "Commercial package", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Source: account_package_summary.commercial_package_label." },
    { key: "package_follow_day_cap", label: "Package follow cap/day", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only", helper: "Strict package ceiling from commercial_packages." },
    { key: "manual_follow_day_cap", label: "Manual follow cap/day", type: "number", min: 0, runtimeStatus: "active", helper: "Saved to Supabase. Effective cap uses min(package, warmup, manual, remaining today)." },
    { key: "manual_follow_session_cap", label: "Manual follow cap/session", type: "number", min: 0, runtimeStatus: "active", helper: "Saved to Supabase. Worker uses this as the Follow per-run ceiling when runtime wiring is available." },
    { key: "effective_follow_cap_today", label: "Effective follow cap today", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only", helper: "Preview: min(package cap, warmup cap, manual day/session caps, remaining today)." },
    { key: "follow_limiting_reason", label: "Limiting reason", type: "text", readOnly: true, runtimeStatus: "read-only" },
    { key: "warmup_enabled", label: "Warmup enabled", type: "toggle", runtimeStatus: "active", helper: "Saved in account_warmup_settings. Requires package/service start date to apply a ramp." },
    { key: "warmup_status", label: "Warmup status", type: "text", readOnly: true, runtimeStatus: "read-only" },
    { key: "warmup_day", label: "Current warmup day", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only" },
    { key: "package_started_at", label: "Package/service start date", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Pending until an operator sets the package/service start date. No silent warmup reset." },
    { key: "day_1_follow_cap", label: "Day 1 follow cap", type: "number", min: 0, runtimeStatus: "active", helper: "Strict maximum: 10. Save refuses higher values." },
    { key: "day_2_follow_cap", label: "Day 2 follow cap", type: "number", min: 0, runtimeStatus: "active", helper: "Strict maximum: 20. Save refuses higher values." },
    { key: "day_3_follow_cap", label: "Day 3 follow cap", type: "number", min: 0, runtimeStatus: "active", helper: "Strict maximum: 40. Save refuses higher values." },
    { key: "day_4_plus_follow_cap", label: "Day 4+ follow cap", type: "number", min: 0, runtimeStatus: "active", helper: "Strict maximum: package Follow cap." },
    { key: "effective_warmup_cap_today", label: "Effective warmup cap today", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only" },
  ],
  DM: [
    { key: "welcome_dm_runtime_enabled", label: "Welcome enabled", type: "toggle", readOnly: true, runtimeStatus: "read-only", helper: "Source: ig_account_dm_settings.welcome_enabled." },
    { key: "welcome_dm_real_send_status", label: "Welcome real-send status", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Source: WELCOME_DM_REAL_SEND_ENABLED." },
    { key: "welcome_dm_template_status", label: "Welcome template status", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Active configured or default Welcome template." },
    { key: "welcome_dm_effective_cap", label: "Welcome effective cap", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only", helper: "Source: ig_account_dm_settings.welcome_per_session_limit; mini-run still requires hard cap proof." },
    { key: "welcome_dm_effective_day_cap", label: "Welcome day cap", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only", helper: "Source: ig_account_dm_settings.welcome_per_day_limit; package default/max 10." },
    { key: "outreach_dm_runtime_enabled", label: "Outreach enabled", type: "toggle", readOnly: true, runtimeStatus: "read-only", helper: "Source: ig_account_dm_settings.outreach_enabled." },
    { key: "outreach_entitlement_status", label: "Outreach entitlement", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Source: client_account_has_outreach_entitlement." },
    { key: "outreach_dm_real_send_status", label: "Outreach real-send status", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Source: OUTREACH_DM_REAL_SEND_ENABLED." },
    { key: "outreach_dm_template_status", label: "Outreach template status", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Active configured or default Outreach template." },
    { key: "outreach_dm_effective_session_cap", label: "Outreach session cap", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only", helper: "Source: ig_account_dm_settings.outreach_per_session_limit." },
    { key: "outreach_dm_effective_day_cap", label: "Outreach day cap", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only", helper: "Source: ig_account_dm_settings.outreach_per_day_limit." },
    { key: "dm_legacy_gate_status", label: "Legacy DM sender flag", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "Read-only only. DM_SENDER_REAL_SEND_ENABLED must not control Welcome or Outreach." },
    { key: "max_dm_per_run_legacy_status", label: "Legacy shared DM cap", type: "text", readOnly: true, runtimeStatus: "read-only", helper: "max_dm_per_run is no longer a valid shared Welcome/Outreach control." },
  ],
  Followback: [
    { key: "unfollow_enabled", label: "Unfollow enabled", type: "toggle", hideHelper: true },
    {
      key: "unfollow_mode",
      label: "Unfollow mode",
      type: "select",
      options: ["unfollow", "unfollow-any", "unfollow-non-followers"],
      disabledOptions: ["unfollow-non-followers"],
      optionLabels: {
        "unfollow": "Standard Unfollow · Default",
        "unfollow-any": "Unfollow any",
        "unfollow-non-followers": "Unfollow non-followers · Coming later",
      },
      hideHelper: true,
    },
    { key: "unfollow_per_session_limit", label: "Unfollow cap/session", type: "number", min: 0, hideHelper: true },
    { key: "unfollow_per_day_limit", label: "Unfollow cap/day", type: "number", min: 0, hideHelper: true },
    { key: "unfollow_after_days", label: "Unfollow delay days", type: "number", min: 0, hideHelper: true },
    {
      key: "runtime_cap_mode",
      label: "Runtime cap mode",
      type: "select",
      options: ["prod_normal", "mini_run", "incident_safety"],
      optionLabels: {
        prod_normal: "Production normal",
        mini_run: "Mini-run",
        incident_safety: "Incident safety",
      },
      helper: "prod_normal follows Supabase caps; mini/safety can intentionally lower the runtime cap.",
    },
    { key: "runtime_safety_cap", label: "Runtime safety cap", type: "number", min: 0, helper: "Not active in Production normal. Used only in mini_run or incident_safety; use 1 for test mini-runs." },
    { key: "effective_unfollow_cap", label: "Effective cap now", type: "number", min: 0, readOnly: true, helper: "Lowest active limit for the next run" },
    { key: "limiting_reason", label: "Limiting reason", type: "text", readOnly: true, hideHelper: true },
    { key: "runtime_cap_source", label: "Runtime cap source", type: "text", readOnly: true, hideHelper: true },
    { key: "follow_entitlement_status", label: "Follow entitlement", type: "text", readOnly: true, hideHelper: true },
    { key: "unfollow_entitlement_status", label: "Unfollow entitlement", type: "text", readOnly: true, hideHelper: true },
    { key: "handoff_real_status", label: "Handoff status", type: "text", readOnly: true, hideHelper: true },
    { key: "unfollow_any_runtime_block_reason", label: "Run block", type: "text", readOnly: true, hideHelper: true },
    { key: "safe_candidate_strategy_status", label: "Safe candidate strategy", type: "text", readOnly: true, hideHelper: true },
    { key: "do_unfollow_first", label: "Do unfollow first", type: "toggle", disabled: true, helper: "Planned" },
  ],
  Sources: [],
  Safety: [
    { key: "total_interactions_limit", label: "Total interactions limit", type: "number", min: 0, runtimeStatus: "needs-routing", helper: "Does not protect runtime until domain caps are wired." },
    { key: "total_successful_interactions_limit", label: "Total successful interactions limit", type: "number", min: 0, runtimeStatus: "needs-routing", helper: "Does not protect runtime until domain caps are wired." },
    { key: "interactions_count", label: "Interactions count", type: "number", min: 0, readOnly: true, runtimeStatus: "read-only", helper: "Counter projection only. Runtime counters come from logs/domain tables." },
    { key: "end_if_follow_limit_reached", label: "End if follow limit reached", type: "toggle", runtimeStatus: "needs-routing" },
    { key: "end_if_dm_limit_reached", label: "End if DM limit reached", type: "toggle", runtimeStatus: "needs-routing" },
    { key: "end_if_likes_limit_reached", label: "End if likes limit reached", type: "toggle", runtimeStatus: "needs-routing" },
    { key: "max_actions_per_hour", label: "Max actions per hour", type: "number", min: 0, runtimeStatus: "needs-routing", helper: "Target: package/safety cap resolver." },
    { key: "max_actions_per_day", label: "Max actions per day", type: "number", min: 0, runtimeStatus: "needs-routing", helper: "Target: package/safety cap resolver." },
    { key: "random_delay_min_seconds", label: "Random delay min seconds", type: "number", min: 0, runtimeStatus: "needs-routing", helper: "Target: pacing domain policy." },
    { key: "random_delay_max_seconds", label: "Random delay max seconds", type: "number", min: 0, runtimeStatus: "needs-routing", helper: "Target: pacing domain policy." },
    { key: "warmup_mode", label: "Legacy warmup mode", type: "toggle", readOnly: true, runtimeStatus: "deprecated", helper: "Superseded by Follow tab account_warmup_settings." },
    { key: "stop_on_suspicious_screen", label: "Stop on suspicious screen", type: "toggle", runtimeStatus: "needs-routing", helper: "Target: recovery/incident policy API." },
    { key: "stop_on_login_challenge", label: "Stop on login challenge", type: "toggle", runtimeStatus: "needs-routing", helper: "Target: recovery/incident policy API." },
    { key: "stop_on_checkpoint", label: "Stop on checkpoint", type: "toggle", runtimeStatus: "needs-routing", helper: "Target: recovery/incident policy API." },
    { key: "stop_on_repeated_navigation_failure", label: "Stop on repeated navigation failure", type: "toggle", runtimeStatus: "needs-routing", helper: "Target: recovery engine policy API." },
    { key: "max_repeated_errors", label: "Max repeated errors", type: "number", min: 0, runtimeStatus: "needs-routing", helper: "Target: recovery engine policy API." },
  ],
};

function settingsFieldsForTab(tab: DisplayedSettingsTab): FieldSpec[] {
  if (tab === "Filters") return [];
  return settingsFields[tab];
}

type PlannedFilterCard = {
  title: string;
  description: string;
};

const plannedFilterCards: PlannedFilterCard[] = [
  {
    title: "Profile quality",
    description: "Require profile photo and verified-account rules.",
  },
  {
    title: "Business / creator",
    description: "Skip or target business and creator account types.",
  },
  {
    title: "Blacklist / whitelist",
    description: "Word lists and account exclusion policies.",
  },
  {
    title: "Outreach filters",
    description: "Skip already DM'd, replied, blocked, and source-type rules.",
  },
  {
    title: "Target quality",
    description: "Target verification thresholds and source health rules.",
  },
];

function scheduleSlotKey(startsAt: string, endsAt: string) {
  return `${startsAt}|${endsAt}`;
}

function scheduleSlotKeyFromAssignment(assignment: ScheduleProjection["current_assignment"]) {
  if (!assignment) return "";
  return scheduleSlotKey(assignment.starts_at, assignment.ends_at);
}

function findScheduleSlot(schedule: ScheduleProjection, slotKey: string) {
  return schedule.available_slots.find((slot) => scheduleSlotKey(slot.starts_at, slot.ends_at) === slotKey) ?? null;
}

function scheduleDirty(
  schedule: ScheduleProjection,
  baseline: ScheduleProjection,
  selectedSlotKey: string,
) {
  const baselineKey = scheduleSlotKeyFromAssignment(baseline.current_assignment);
  return selectedSlotKey !== baselineKey;
}

function scheduleValidationError(schedule: ScheduleProjection | null, selectedSlotKey: string) {
  if (!schedule?.save_ready) return "Schedule save is unavailable until slot API is ready.";
  if (!selectedSlotKey) return "Select an available slot before saving.";
  const slot = findScheduleSlot(schedule, selectedSlotKey);
  if (!slot) return "Selected slot is no longer available.";
  if (!slot.available) {
    if (slot.reason === "phone_rest") return "Selected slot is blocked by a fixed blackout window.";
    if (slot.reason === "outreach_rest_reserved") return "Selected Outreach slot is reserved for phone rest.";
    if (slot.reason === "no_app_instance_available") return "Selected slot has no free Instagram app instance on this device.";
    if (slot.reason === "no_clone_available") return "Selected slot has no free clone on this device.";
    return "Selected slot is occupied.";
  }
  return "";
}

export {
  scheduleSlotKey,
  scheduleSlotKeyFromAssignment,
  findScheduleSlot,
  scheduleDirty,
  scheduleValidationError,
};

export async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let payload: ApiEnvelope<T> | { error?: string } | T | null = null;
  const trimmedText = text.trim();

  if (trimmedText.includes("NEXT_REDIRECT")) {
    throw new Error("Authentication required. Please sign in again.");
  }

  if (trimmedText) {
    try {
      payload = JSON.parse(trimmedText) as ApiEnvelope<T> | { error?: string } | T;
    } catch {
      throw new Error(response.ok ? fallback : `Request failed (${response.status}). ${fallback}`);
    }
  }

  if (!payload) {
    throw new Error(response.ok ? fallback : `Request failed (${response.status}). ${fallback}`);
  }

  if (typeof payload === "object" && "ok" in payload) {
    if (payload.ok) return payload.data;
    throw new Error(payload.error || fallback);
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? payload.error : "";
    throw new Error(message || `Request failed (${response.status}). ${fallback}`);
  }

  return payload as T;
}

function boolText(value: boolean) {
  return value ? "Enabled" : "Disabled";
}

function runtimeStatusPrefix(status?: RuntimeStatus) {
  switch (status) {
    case "active":
      return "Active / routed";
    case "needs-routing":
      return "Needs routing · Draft only — not runtime-active yet";
    case "read-only":
      return "Read-only";
    case "ops-only":
      return "Ops-only";
    case "deprecated":
      return "Deprecated";
    default:
      return null;
  }
}

function buildFieldHelper(field: FieldSpec) {
  if (field.hideHelper) return undefined;
  const parts = [runtimeStatusPrefix(field.runtimeStatus), field.helper, field.readOnly && !field.runtimeStatus ? "Read-only projection." : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function formatMs(value: number | undefined) {
  const ms = value ?? 0;
  if (!ms) return "0 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${ms} ms`;
}

function exportTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/[:T]/g, "-");
}

function formatExportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function safeFilenamePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "account";
}

function downloadUtf8File(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatMetadata(metadata: unknown) {
  if (metadata === null || typeof metadata === "undefined" || metadata === "") return "";
  if (typeof metadata === "string") return metadata;
  return JSON.stringify(metadata, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function logPerformanceSummary(log: LogRow) {
  if (log.performance_summary !== null && typeof log.performance_summary !== "undefined") return log.performance_summary;
  if (isRecord(log.payload) && isRecord(log.payload.performance_summary)) return log.payload.performance_summary;
  return null;
}

function compactMetadata(metadata: unknown) {
  const formatted = formatMetadata(metadata).replace(/\s+/g, " ").trim();
  if (!formatted) return "—";
  return formatted.length > 180 ? `${formatted.slice(0, 180)}...` : formatted;
}

function settingString(settings: InstagramSettings, key: string, fallback = "") {
  const value = settings[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function settingNumber(settings: InstagramSettings, key: string, fallback = 0) {
  const value = settings[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function settingBoolean(settings: InstagramSettings, key: string, fallback = false) {
  const value = settings[key];
  return typeof value === "boolean" ? value : fallback;
}

function withDmDomainProjection(settings: InstagramSettings, projection: DmDomainProjection): InstagramSettings {
  return {
    ...settings,
    welcome_dm_runtime_enabled: projection.welcome_enabled,
    outreach_dm_runtime_enabled: projection.outreach_enabled,
    welcome_dm_message: projection.welcome_message,
    cold_dm_message: projection.outreach_message,
    welcome_dm_template_status: projection.welcome_template_status,
    outreach_dm_template_status: projection.outreach_template_status,
    welcome_entitlement_status: projection.welcome_entitlement_status,
    outreach_entitlement_status: projection.outreach_entitlement_status,
    welcome_dm_effective_cap: projection.welcome_cap_session,
    welcome_dm_effective_day_cap: projection.welcome_cap_day,
    outreach_dm_effective_session_cap: projection.outreach_cap_session,
    outreach_dm_effective_day_cap: projection.outreach_cap_day,
    welcome_dm_real_send_status: projection.welcome_real_send_status,
    outreach_dm_real_send_status: projection.outreach_real_send_status,
    dm_legacy_gate_status: projection.legacy_dm_gate_status,
    dm_domain_save_ready: projection.save_ready,
  };
}

function withUnfollowDomainProjection(settings: InstagramSettings, projection: UnfollowDomainProjection): InstagramSettings {
  return {
    ...settings,
    unfollow_enabled: projection.unfollow_enabled,
    unfollow_mode: projection.unfollow_mode,
    unfollow_per_session_limit: projection.unfollow_per_session_limit,
    unfollow_per_day_limit: projection.unfollow_per_day_limit,
    unfollow_after_days: projection.unfollow_after_days,
    runtime_cap_mode: projection.runtime_cap_mode,
    runtime_safety_cap: projection.runtime_safety_cap ?? 0,
    effective_unfollow_cap: projection.effective_unfollow_cap,
    runtime_hard_cap: projection.runtime_hard_cap,
    unfollow_day_remaining: projection.unfollow_day_remaining ?? "",
    limiting_reason: projection.limiting_reason,
    runtime_cap_source: projection.runtime_cap_source,
    follow_entitlement_status: projection.follow_entitlement_status,
    unfollow_entitlement_status: projection.unfollow_entitlement_status,
    current_runtime_mode: projection.current_runtime_mode,
    handoff_real_status: projection.handoff_real_status,
    safe_candidate_strategy_status: projection.safe_candidate_strategy_status,
    unfollow_runtime_mode: projection.current_runtime_mode,
    unfollow_runtime_session_cap: projection.unfollow_per_session_limit,
    unfollow_any_runtime_configured: projection.unfollow_enabled && projection.unfollow_mode === "unfollow-any",
    unfollow_any_runtime_state:
      projection.unfollow_enabled && projection.unfollow_mode === "unfollow-any"
        ? projection.block_reason
          ? "Configured but blocked by runtime gate"
          : "Ready"
        : "Disabled",
    unfollow_any_runtime_block_reason: humanizeUnfollowBlockReason(projection.block_reason),
    do_unfollow_first: false,
  };
}

function humanizeUnfollowBlockReason(reason: string) {
  if (!reason) return "";
  if (reason === "unfollow_handoff_disabled") return "Follow-to-Unfollow handoff is disabled";
  if (reason === "unfollow_no_safe_candidate_strategy") return "No safe candidate strategy is ready";
  if (reason === "unfollow_day_quota_exhausted") return "Daily Unfollow quota is exhausted";
  if (reason === "unfollow_entitlement_missing") return "Unfollow entitlement is missing";
  if (reason === "unfollow_cap_unproven") return "Effective Unfollow cap is not ready";
  if (reason === "unfollow_mode_not_supported") return "Selected Unfollow mode is not supported";
  return reason.replaceAll("_", " ");
}

export function dmDomainPayload(settings: InstagramSettings) {
  return {
    account_id: settings.account_id,
    welcome_enabled: settingBoolean(settings, "welcome_dm_runtime_enabled", settingBoolean(settings, "welcome_dm_enabled")),
    welcome_message: normalizeDmTemplateMessage(settingString(settings, "welcome_dm_message")),
    welcome_cap_session: settingNumber(settings, "welcome_dm_effective_cap", 0),
    welcome_cap_day: settingNumber(settings, "welcome_dm_effective_day_cap", DEFAULT_WELCOME_DM_DAY_CAP),
    outreach_enabled: settingBoolean(settings, "outreach_dm_runtime_enabled", settingBoolean(settings, "cold_dm_enabled")),
    outreach_message: normalizeDmTemplateMessage(settingString(settings, "cold_dm_message")),
    outreach_cap_session: settingNumber(settings, "outreach_dm_effective_session_cap", 0),
    outreach_cap_day: settingNumber(settings, "outreach_dm_effective_day_cap", 0),
  };
}

function sameDmPayload(left: InstagramSettings | null, right: InstagramSettings | null) {
  if (!left || !right) return true;
  return JSON.stringify(dmDomainPayload(left)) === JSON.stringify(dmDomainPayload(right));
}

export function unfollowDomainPayload(settings: InstagramSettings) {
  return {
    account_id: settings.account_id,
    unfollow_enabled: settingBoolean(settings, "unfollow_enabled", false),
    unfollow_mode: settingString(settings, "unfollow_mode", "unfollow"),
    unfollow_per_session_limit: settingNumber(settings, "unfollow_per_session_limit", 0),
    unfollow_per_day_limit: settingNumber(settings, "unfollow_per_day_limit", 0),
    unfollow_after_days: settingNumber(settings, "unfollow_after_days", 3),
    runtime_cap_mode: settingString(settings, "runtime_cap_mode", "prod_normal"),
    runtime_safety_cap:
      settingString(settings, "runtime_cap_mode", "prod_normal") === "prod_normal"
        ? null
        : settingNumber(settings, "runtime_safety_cap", 0),
  };
}

function sameUnfollowPayload(left: InstagramSettings | null, right: InstagramSettings | null) {
  if (!left || !right) return true;
  return JSON.stringify(unfollowDomainPayload(left)) === JSON.stringify(unfollowDomainPayload(right));
}

function sameFollowFiltersPayload(left: FollowFiltersProjection | null, right: FollowFiltersProjection | null) {
  if (!left || !right) return true;
  return (
    left.skip_private_profiles === right.skip_private_profiles &&
    left.min_followers === right.min_followers &&
    left.max_followers === right.max_followers &&
    left.min_posts === right.min_posts
  );
}

function followFiltersValidationError(filters: FollowFiltersProjection | null) {
  if (!filters) return "";
  for (const [label, value] of [
    ["Min followers", filters.min_followers],
    ["Max followers", filters.max_followers],
    ["Min posts", filters.min_posts],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      return `${label} must be a whole number greater than or equal to 0.`;
    }
  }
  if (
    filters.min_followers !== null &&
    filters.max_followers !== null &&
    filters.min_followers > filters.max_followers
  ) {
    return "Min followers cannot be greater than Max followers.";
  }
  return "";
}

export function unfollowClientValidationError(settings: InstagramSettings) {
  const enabled = settingBoolean(settings, "unfollow_enabled", false);
  const mode = settingString(settings, "unfollow_mode", "unfollow").trim().toLowerCase();
  const runtimeCapMode = settingString(settings, "runtime_cap_mode", "prod_normal").trim().toLowerCase();
  const sessionCap = settingNumber(settings, "unfollow_per_session_limit", 0);
  const dayCap = settingNumber(settings, "unfollow_per_day_limit", 0);
  const runtimeSafetyCap = settingNumber(settings, "runtime_safety_cap", 0);
  if (mode === "unfollow-non-followers") return "unfollow_non_followers_planned";
  if (mode !== "unfollow" && mode !== "unfollow-any") return "unfollow_mode_not_supported";
  if (!["prod_normal", "mini_run", "incident_safety"].includes(runtimeCapMode)) return "runtime_cap_mode_not_supported";
  if (enabled && (sessionCap < 1 || dayCap < 1)) return "unfollow_cap_unproven";
  if (enabled && runtimeCapMode !== "prod_normal" && runtimeSafetyCap < 1) return "unfollow_cap_unproven";
  if (enabled && sessionCap > dayCap) return "session_cap_exceeds_day_cap";
  return "";
}

export function dmClientValidationError(settings: InstagramSettings) {
  const welcomeEnabled = settingBoolean(settings, "welcome_dm_runtime_enabled", settingBoolean(settings, "welcome_dm_enabled"));
  const outreachEnabled = settingBoolean(settings, "outreach_dm_runtime_enabled", settingBoolean(settings, "cold_dm_enabled"));
  const welcomeMessage = normalizeDmTemplateMessage(settingString(settings, "welcome_dm_message"));
  const outreachMessage = normalizeDmTemplateMessage(settingString(settings, "cold_dm_message"));
  if (welcomeEnabled && !welcomeMessage.trim()) return "Welcome message is required";
  if (outreachEnabled && !outreachMessage.trim()) return "Outreach message is required";
  const welcomeLengthError = dmTemplateLengthError("Welcome", welcomeMessage);
  if (welcomeLengthError) return welcomeLengthError;
  const outreachLengthError = dmTemplateLengthError("Outreach", outreachMessage);
  if (outreachLengthError) return outreachLengthError;
  if (welcomeEnabled && settingNumber(settings, "welcome_dm_effective_cap", 0) < 1) return "Welcome cap must be at least 1";
  if (welcomeEnabled && settingNumber(settings, "welcome_dm_effective_day_cap", 0) < 1) return "Welcome day cap must be at least 1";
  if (settingNumber(settings, "welcome_dm_effective_day_cap", DEFAULT_WELCOME_DM_DAY_CAP) > DEFAULT_WELCOME_DM_DAY_CAP) {
    return `welcome_daily_cap_exceeded: Welcome day cap cannot exceed ${DEFAULT_WELCOME_DM_DAY_CAP}`;
  }
  if (welcomeEnabled && settingNumber(settings, "welcome_dm_effective_cap", 0) > settingNumber(settings, "welcome_dm_effective_day_cap", DEFAULT_WELCOME_DM_DAY_CAP)) {
    return "session_cap_exceeds_day_cap: Welcome session cap cannot exceed Welcome day cap";
  }
  if (outreachEnabled && (settingNumber(settings, "outreach_dm_effective_session_cap", 0) < 1 || settingNumber(settings, "outreach_dm_effective_day_cap", 0) < 1)) {
    return "Outreach caps must be at least 1";
  }
  if (settingNumber(settings, "outreach_dm_effective_day_cap", DEFAULT_OUTREACH_DM_DAY_CAP) > DEFAULT_OUTREACH_DM_DAY_CAP) {
    return `outreach_daily_cap_exceeded: Outreach day cap cannot exceed ${DEFAULT_OUTREACH_DM_DAY_CAP}`;
  }
  if (outreachEnabled && settingNumber(settings, "outreach_dm_effective_session_cap", 0) > settingNumber(settings, "outreach_dm_effective_day_cap", DEFAULT_OUTREACH_DM_DAY_CAP)) {
    return "session_cap_exceeds_day_cap: Outreach session cap cannot exceed Outreach day cap";
  }
  return "";
}

function normalizedContainsAny(value: string, terms: string[]) {
  const normalized = value.trim().toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

export function getDmServiceAvailability({
  packageLabel = "",
  entitlementSummary = "",
  welcomeEntitlementStatus,
  welcomeEnabled,
  welcomeTemplateStatus,
  outreachEntitlementStatus = "",
  outreachEnabled,
  outreachTemplateStatus,
}: {
  packageLabel?: string | null;
  entitlementSummary?: string | null;
  welcomeEntitlementStatus?: string | null;
  welcomeEnabled?: boolean | null;
  welcomeTemplateStatus?: string | null;
  outreachEntitlementStatus?: string | null;
  outreachEnabled?: boolean | null;
  outreachTemplateStatus?: string | null;
}): DmServiceAvailability {
  const packageText = packageLabel ?? "";
  const entitlementText = entitlementSummary ?? "";
  const normalizedPackageText = packageText.trim().toLowerCase();
  const packageKnown = Boolean(
    (packageText.trim() && normalizedPackageText !== "package pending") || entitlementText.trim(),
  );
  const welcomeStatus = (welcomeEntitlementStatus ?? "").trim().toLowerCase();
  const outreachStatus = (outreachEntitlementStatus ?? "").trim().toLowerCase();
  const welcomeTemplate = (welcomeTemplateStatus ?? "").trim().toLowerCase();
  const outreachTemplate = (outreachTemplateStatus ?? "").trim().toLowerCase();
  const hasWelcomeRuntimeSignal =
    typeof welcomeEnabled === "boolean" || Boolean(welcomeEntitlementStatus?.trim() || welcomeTemplateStatus?.trim());
  const hasOutreachRuntimeSignal =
    typeof outreachEnabled === "boolean" || Boolean(outreachEntitlementStatus?.trim() || outreachTemplateStatus?.trim());
  const welcomePackageFallback = normalizedContainsAny(packageText, ["pro", "premium"]);
  const outreachPackageFallback = normalizedContainsAny(packageText, ["outreach standalone"]);

  const welcomeServiceActive =
    ["active", "enabled", "ready", "included"].includes(welcomeStatus) ||
    normalizedContainsAny(entitlementText, ["welcome"]) ||
    welcomeEnabled === true ||
    welcomeTemplate === "ready" ||
    welcomePackageFallback;
  const outreachServiceActive =
    ["active", "enabled", "ready", "included"].includes(outreachStatus) ||
    normalizedContainsAny(entitlementText, ["outreach"]) ||
    outreachEnabled === true ||
    outreachTemplate === "ready" ||
    outreachPackageFallback;

  return {
    welcomeServiceActive,
    outreachServiceActive,
    welcomeDisabledReason: welcomeServiceActive
      ? null
      : !hasWelcomeRuntimeSignal && !packageKnown
        ? "domain_api_pending"
        : welcomeStatus === "missing" && !packageKnown
          ? "entitlement_missing"
          : "not_included_in_package",
    outreachDisabledReason: outreachServiceActive
      ? null
      : !hasOutreachRuntimeSignal && !packageKnown
        ? "domain_api_pending"
      : outreachPackageFallback || (outreachStatus === "missing" && !packageKnown)
          ? "entitlement_missing"
          : "add_on_not_active",
  };
}

function dmDisabledReasonLabel(reason: DmServiceDisabledReason | null) {
  if (reason === "not_included_in_package") return "Not included in package";
  if (reason === "add_on_not_active") return "Add-on not active";
  if (reason === "entitlement_missing") return "Entitlement missing";
  if (reason === "domain_api_pending") return "Domain API pending";
  return "";
}

function templateSafeSettings(settings: InstagramSettings) {
  const { password, email, device_udid, app_package, cloned_app_mode, ...safeSettings } = settings;
  void password;
  void email;
  void device_udid;
  void app_package;
  void cloned_app_mode;
  [
    "dry_run_enabled",
    "send_enabled",
    "follow_enabled",
    "unfollow_enabled",
    "like_enabled",
    "source_accounts",
    "follow_percentage",
    "likes_percentage",
    "interact_percentage",
    "story_watch_enabled",
    "watch_photo_time_min",
    "watch_photo_time_max",
    "watch_video_time_min",
    "watch_video_time_max",
    "timeout_startup_seconds",
    "speed_multiplier",
    "random_pause_every_actions",
    "long_break_after_interactions",
    "long_break_min_minutes",
    "long_break_max_minutes",
    "disable_block_detection",
    "relog_after_block",
    "relog_delay_seconds",
    "rotate_ip",
    "restart_uiautomator2",
    "close_apps",
    "close_apps_device",
    "log_out_all_before_session",
    "total_crashes_limit",
    "screen_sleep",
    "screen_record",
    "debug_mode",
    "truncate_sources_min",
    "truncate_sources_max",
    "change_source_if_crash",
    "skipped_posts_limit",
    "fling_when_skipped",
    "delete_interacted_users",
    "email_display",
    "password_status",
    "device_assignment",
    "app_package_status",
    "clone_assignment_status",
    "account_status",
    "current_run_status",
    "last_error",
    "last_successful_action",
    "manual_stop_requested",
  ].forEach((key) => {
    delete safeSettings[key];
  });
  return safeSettings;
}

function workerSourceLabel(workerType?: string) {
  return workerType === "python_uiautomator" ? "Python uiautomator" : workerType || "Node/Appium";
}

function logsToText(logs: LogRow[]) {
  return logs
    .map((log) => {
      const performanceSummary = formatMetadata(logPerformanceSummary(log));
      return [
        `[${formatExportDate(log.created_at)}]`,
        `ID: ${log.id}`,
        `ACCOUNT: ${log.account_id}`,
        `RUN: ${log.run_id}`,
        `SOURCE: ${workerSourceLabel(log.worker_type)}`,
        `ACTION: ${log.action_type}`,
        `STATUS: ${log.status}`,
        `TARGET: ${log.target_username}`,
        `MESSAGE: ${log.message}`,
        performanceSummary ? `PERFORMANCE SUMMARY:\n${performanceSummary}` : "",
        "----------------------------------------",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function logsToJson(logs: LogRow[]) {
  return logs.map((log) => ({
    id: log.id,
    run_id: log.run_id,
    account_id: log.account_id,
    target_username: log.target_username,
    action_type: log.action_type,
    status: log.status,
    message: log.message,
    worker_type: log.worker_type || "",
    performance_summary: logPerformanceSummary(log),
    metadata_status: "redacted",
    created_at: log.created_at,
  }));
}

function statsSummary(username: string, rows: StatsRow[]) {
  const statusText = (row: StatsRow) => `${row.status ?? ""}`.toLowerCase();
  const failedRuns = rows.filter((row) => ["fail", "error", "blocked"].some((term) => statusText(row).includes(term))).length;
  const successfulRuns = rows.filter((row) => ["success", "completed", "done"].some((term) => statusText(row).includes(term))).length;
  const oldestRow = rows[rows.length - 1];
  const latestPerformanceRow = rows.find((row) => row.worker_type === "python_uiautomator" || row.total_ms || row.xml_fetches);

  return {
    username,
    total_runs: rows.length,
    successful_runs: successfulRuns,
    failed_runs: failedRuns,
    total_dms: rows.reduce((total, row) => total + (row.dm ?? 0), 0),
    total_follows: rows.reduce((total, row) => total + (row.follow ?? 0), 0),
    total_story_views: rows.reduce((total, row) => total + (row.watch ?? 0), 0),
    created_at: oldestRow?.created_at || oldestRow?.session_time || "",
    last_run_at: rows[0]?.last_run_at || rows[0]?.session_time || "",
    latest_worker_type: latestPerformanceRow?.worker_type || "",
    latest_total_ms: latestPerformanceRow?.total_ms ?? 0,
    latest_typing_command_ms: latestPerformanceRow?.typing_command_ms ?? 0,
    latest_row_detect_ms: latestPerformanceRow?.row_detect_ms ?? 0,
    latest_row_tap_command_ms: latestPerformanceRow?.row_tap_command_ms ?? 0,
    latest_profile_transition_wait_ms: latestPerformanceRow?.profile_transition_wait_ms ?? 0,
    latest_profile_verify_ms: latestPerformanceRow?.profile_verify_ms ?? 0,
    latest_warm_session_used: latestPerformanceRow?.warm_session_used ?? false,
    latest_force_stop_used: latestPerformanceRow?.force_stop_used ?? false,
    latest_xml_fetches: latestPerformanceRow?.xml_fetches ?? 0,
    latest_recovery_used: latestPerformanceRow?.recovery_used ?? false,
    latest_exit_code: latestPerformanceRow?.exit_code ?? "",
  };
}

function csvEscape(value: string | number | boolean) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function statsToCsv(username: string, rows: StatsRow[]) {
  const summary = statsSummary(username, rows);
  const columns = ["username", "total_runs", "successful_runs", "failed_runs", "total_dms", "total_follows", "total_story_views", "created_at", "last_run_at", "latest_worker_type", "latest_total_ms", "latest_typing_command_ms", "latest_row_detect_ms", "latest_row_tap_command_ms", "latest_profile_transition_wait_ms", "latest_profile_verify_ms", "latest_warm_session_used", "latest_force_stop_used", "latest_xml_fetches", "latest_recovery_used", "latest_exit_code"] as const;
  return [
    columns.join(","),
    columns.map((column) => csvEscape(summary[column])).join(","),
  ].join("\n");
}

export default function InstagramDashboardButtons({
  accountId,
  username,
  mode = "active",
  packageLabel = null,
  entitlementSummary = null,
}: InstagramDashboardButtonsProps) {
  const router = useRouter();
  const [styleReady, setStyleReady] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [settings, setSettings] = useState<InstagramSettings | null>(null);
  const [settingsBaseline, setSettingsBaseline] = useState<InstagramSettings | null>(null);
  const [filters, setFilters] = useState<InstagramFilters | null>(null);
  const [followFilters, setFollowFilters] = useState<FollowFiltersProjection | null>(null);
  const [followFiltersBaseline, setFollowFiltersBaseline] = useState<FollowFiltersProjection | null>(null);
  const [schedule, setSchedule] = useState<ScheduleProjection | null>(null);
  const [scheduleBaseline, setScheduleBaseline] = useState<ScheduleProjection | null>(null);
  const [targetsOverview, setTargetsOverview] = useState<TargetsOverview | null>(null);
  const [selectedScheduleSlotKey, setSelectedScheduleSlotKey] = useState("");
  const [templates, setTemplates] = useState<AccountTemplate[]>([]);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("General");
  const [statsRows, setStatsRows] = useState<StatsRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMenu, setExportMenu] = useState<ExportMenu>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [templateDialog, setTemplateDialog] = useState<TemplateDialog>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [runControlHealth, setRunControlHealth] = useState<RunControlHealth | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const titleId = `ig-panel-title-${accountId.replace(/[^a-zA-Z0-9_-]/g, "-") || "account"}`;

  useEffect(() => {
    setStyleReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRunControlHealth() {
      try {
        const payload = await readApiResponse<RunControlHealth>(
          await fetch("/api/instagram-dashboard/runs/health", { headers: { Accept: "application/json" } }),
          "Could not load run control health."
        );
        if (!cancelled) setRunControlHealth(payload);
      } catch (healthError) {
        if (!cancelled) {
          setRunControlHealth({
            healthy: false,
            playEnabled: false,
            reason: healthError instanceof Error && /auth/i.test(healthError.message)
              ? "admin_session_required"
              : "dispatcher_unhealthy",
          });
        }
      }
    }

    void loadRunControlHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  function requestConfirmation(confirmationConfig: Confirmation) {
    setConfirmation(confirmationConfig);
  }

  async function runExport(action: () => void | Promise<void>, successMessage: string) {
    setIsExporting(true);
    setError("");
    setSuccess("");

    try {
      await action();
      setSuccess(successMessage);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export data.");
    } finally {
      setExportMenu(null);
      setIsExporting(false);
    }
  }

  async function fetchLogsForExport(scope: LogExportScope) {
    return readApiResponse<LogRow[]>(
      await fetch(`/api/instagram-dashboard/logs?account_id=${encodeURIComponent(accountId)}&scope=${encodeURIComponent(scope)}`, { headers: { Accept: "application/json" } }),
      "Could not load account logs for export."
    );
  }

  function exportLogs(format: "txt" | "json", scope: LogExportScope) {
    void runExport(async () => {
      const exportRows = await fetchLogsForExport(scope);
      const filenameScope = scope === "all" ? "all" : scope === "latest-python-run" ? "latest-python-run" : "latest-run";
      const filename = `logs-${filenameScope}-${safeFilenamePart(username)}-${exportTimestamp()}.${format}`;
      const content = format === "txt" ? logsToText(exportRows) : JSON.stringify(logsToJson(exportRows), null, 2);
      downloadUtf8File(filename, content, format === "txt" ? "text/plain" : "application/json");
    }, scope === "all" ? "All logs exported successfully" : scope === "latest-python-run" ? "Latest Python run logs exported successfully" : "Latest run logs exported successfully");
  }

  function exportStats(format: "csv" | "json") {
    void runExport(() => {
      const filename = `stats-${safeFilenamePart(username)}-${exportTimestamp()}.${format}`;
      const content = format === "csv" ? statsToCsv(username, statsRows) : JSON.stringify([statsSummary(username, statsRows)], null, 2);
      downloadUtf8File(filename, content, format === "csv" ? "text/csv" : "application/json");
    }, "Stats exported successfully");
  }

  function copyLogs() {
    void runExport(async () => {
      if (!navigator.clipboard) throw new Error("Clipboard is unavailable in this browser.");
      await navigator.clipboard.writeText(logsToText(logs));
    }, "Logs copied to clipboard");
  }

  function closeConfirmation() {
    if (isSaving) return;
    setConfirmation(null);
  }

  async function confirmAction() {
    const pendingConfirmation = confirmation;
    if (!pendingConfirmation) return;

    setConfirmation(null);
    await pendingConfirmation.onConfirm();
  }

  async function loadPanel(nextPanel: Exclude<Panel, null>) {
    setPanel(nextPanel);
    if (nextPanel === "settings") setSettingsTab("General");
    if (nextPanel === "filters") setSettingsTab("Filters");
    setIsLoading(true);
    setError("");
    setSuccess("");

    try {
      if (nextPanel === "settings" || nextPanel === "filters") {
        const [settingsPayload, followFiltersPayload, schedulePayload, templatePayload, targetsPayload] = await Promise.all([
          readApiResponse<InstagramSettings>(
            await fetch(`/api/instagram-dashboard/settings?account_id=${encodeURIComponent(accountId)}`, { headers: { Accept: "application/json" } }),
            "Could not load account settings."
          ),
          readApiResponse<FollowFiltersProjection>(
            await fetch(`/api/instagram-dashboard/settings/follow-filters?account_id=${encodeURIComponent(accountId)}`, { headers: { Accept: "application/json" } }),
            "Could not load Follow filter settings."
          ),
          readApiResponse<ScheduleProjection>(
            await fetch(`/api/instagram-dashboard/settings/schedule?account_id=${encodeURIComponent(accountId)}`, { headers: { Accept: "application/json" } }),
            "Could not load Schedule settings."
          ),
          readApiResponse<AccountTemplate[]>(
            await fetch("/api/instagram-dashboard/templates", { headers: { Accept: "application/json" } }),
            "Could not load account templates."
          ),
          loadTargetsOverview(),
        ]);
        setSettings(settingsPayload);
        setSettingsBaseline(settingsPayload);
        setFollowFilters(followFiltersPayload);
        setFollowFiltersBaseline(followFiltersPayload);
        setSchedule(schedulePayload);
        setScheduleBaseline(schedulePayload);
        setTargetsOverview(targetsPayload);
        setSelectedScheduleSlotKey(scheduleSlotKeyFromAssignment(schedulePayload.current_assignment));
        setTemplates(templatePayload);
      }

      if (nextPanel === "stats") {
        const rows = await readApiResponse<StatsRow[]>(
          await fetch(`/api/instagram-dashboard/stats?account_id=${encodeURIComponent(accountId)}`, { headers: { Accept: "application/json" } }),
          "Could not load account statistics."
        );
        setStatsRows(rows ?? []);
      }

      if (nextPanel === "logs") {
        const rows = await readApiResponse<LogRow[]>(
          await fetch(`/api/instagram-dashboard/logs?account_id=${encodeURIComponent(accountId)}`, { headers: { Accept: "application/json" } }),
          "Could not load account logs."
        );
        setLogs(rows ?? []);
      }

    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load account data.");
    } finally {
      setIsLoading(false);
    }
  }

  function closePanel() {
    if (isSaving) return;
    setPanel(null);
    setError("");
    setSuccess("");
    setSettings(null);
    setSettingsBaseline(null);
    setFilters(null);
    setFollowFilters(null);
    setFollowFiltersBaseline(null);
    setTargetsOverview(null);
    setTemplates([]);
    setTemplateDialog(null);
    setSettingsTab("General");
    setStatsRows([]);
    setLogs([]);
  }

  function updateSetting(key: string, value: ConfigValue) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  async function loadDmDomainSettings() {
    try {
      const projection = await readApiResponse<DmDomainProjection>(
        await fetch(`/api/instagram-dashboard/settings/dm?account_id=${encodeURIComponent(accountId)}`, {
          headers: { Accept: "application/json" },
        }),
        "Could not load DM domain settings.",
      );
      setSettings((current) => (current ? withDmDomainProjection(current, projection) : current));
      setSettingsBaseline((current) => (current ? withDmDomainProjection(current, projection) : current));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load DM domain settings.");
    }
  }

  async function loadTargetsOverview() {
    try {
      const rows = await readApiResponse<TargetSafeRow[]>(
        await fetch(`/api/instagram-dashboard/targets?account_id=${encodeURIComponent(accountId)}`, {
          headers: { Accept: "application/json" },
        }),
        "Could not load target accounts.",
      );
      return buildTargetsOverview(rows ?? []);
    } catch {
      return null;
    }
  }

  async function loadFollowFiltersDomain() {
    try {
      const projection = await readApiResponse<FollowFiltersProjection>(
        await fetch(`/api/instagram-dashboard/settings/follow-filters?account_id=${encodeURIComponent(accountId)}`, {
          headers: { Accept: "application/json" },
        }),
        "Could not load Follow filter settings.",
      );
      setFollowFilters(projection);
      setFollowFiltersBaseline(projection);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Follow filter settings.");
    }
  }

  async function selectSettingsTab(tab: SettingsTab) {
    setSettingsTab(tab);
    if (tab === "DM") {
      await loadDmDomainSettings();
    }
    if (tab === "Filters") {
      await loadFollowFiltersDomain();
    }
  }

  async function refreshAccountConfig() {
    const [settingsPayload, filtersPayload, templatePayload] = await Promise.all([
      readApiResponse<InstagramSettings>(
        await fetch(`/api/instagram-dashboard/settings?account_id=${encodeURIComponent(accountId)}`, { headers: { Accept: "application/json" } }),
        "Could not load account settings."
      ),
      readApiResponse<InstagramFilters>(
        await fetch(`/api/instagram-dashboard/filters?account_id=${encodeURIComponent(accountId)}`, { headers: { Accept: "application/json" } }),
        "Could not load account filters."
      ),
      readApiResponse<AccountTemplate[]>(
        await fetch("/api/instagram-dashboard/templates", { headers: { Accept: "application/json" } }),
        "Could not load account templates."
      ),
    ]);
    setSettings(settingsPayload);
    setSettingsBaseline(settingsPayload);
    setFilters(filtersPayload);
    setTemplates(templatePayload);
  }

  async function saveTemplate(name: string, description: string, templateType: "settings" | "filters" | "full") {
    if (!settings || !filters || !templateDialog) return;

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const savedTemplate = await readApiResponse<AccountTemplate>(
        await fetch("/api/instagram-dashboard/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            name,
            description,
            template_type: templateType,
            settings_payload: templateDialog.source === "settings" || templateType === "full" ? templateSafeSettings(settings) : {},
            filters_payload: templateDialog.source === "filters" || templateType === "full" ? filters : {},
          }),
        }),
        "Could not save account template."
      );
      setTemplates((current) => [savedTemplate, ...current]);
      setTemplateDialog(null);
      setSuccess("Template saved.");
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : "Could not save account template.");
    } finally {
      setIsSaving(false);
    }
  }

  function requestApplyTemplate(templateId: string) {
    setTemplateDialog(null);
    requestConfirmation({
      title: "🚨 Apply this template to this account? ⚠️",
      description: "The selected template will update this Account settings and/or filters. No worker action will run.",
      confirmTone: "primary",
      onConfirm: () => applyTemplate(templateId),
    });
  }

  async function applyTemplate(templateId: string) {
    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      await readApiResponse(
        await fetch("/api/instagram-dashboard/templates/apply", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId, template_id: templateId }),
        }),
        "Could not apply account template."
      );
      await refreshAccountConfig();
      setSuccess("Dashboard draft template applied. Runtime wiring is still pending for fields marked Needs routing.");
      router.refresh();
    } catch (templateError) {
      setError(templateError instanceof Error ? templateError.message : "Could not apply account template.");
    } finally {
      setIsSaving(false);
    }
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;

    requestConfirmation({
      title: "Save dashboard draft settings?",
      description: "These values will be saved as dashboard draft settings. Fields marked Needs routing are not runtime-active until domain wiring is complete.",
      confirmTone: "primary",
      onConfirm: performSaveSettings,
    });
  }

  async function performSaveSettings() {
    if (!settings) return;

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const savedSettings = await readApiResponse<InstagramSettings>(
        await fetch("/api/instagram-dashboard/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(settings),
        }),
        "Could not save account settings."
      );
      setSettings(savedSettings);
      setSettingsBaseline(savedSettings);
      setSuccess("Dashboard draft settings saved. Runtime wiring is still pending for fields marked Needs routing.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save account settings.");
    } finally {
      setIsSaving(false);
    }
  }

  function saveDmSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || sameDmPayload(settings, settingsBaseline)) return;

    requestConfirmation({
      title: "Save DM settings?",
      description: "This will update the Welcome DM and Outreach DM settings in the runtime domain tables.\nIt will not start a run or send any messages.",
      confirmTone: "primary",
      confirmLabel: "Save settings",
      onConfirm: performSaveDmSettings,
    });
  }

  async function performSaveDmSettings() {
    if (!settings) return;

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const projection = await readApiResponse<DmDomainProjection>(
        await fetch("/api/instagram-dashboard/settings/dm", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(dmDomainPayload(settings)),
        }),
        "Could not save DM domain settings."
      );
      const savedSettings = withDmDomainProjection(settings, projection);
      setSettings(savedSettings);
      setSettingsBaseline(savedSettings);
      setSuccess("DM domain settings saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save DM domain settings.");
    } finally {
      setIsSaving(false);
    }
  }

  function saveUnfollowSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || sameUnfollowPayload(settings, settingsBaseline)) return;

    requestConfirmation({
      title: "Save Unfollow settings?",
      description: "This will update the Followback / Unfollow settings.\nIt will not start a run or perform any Unfollow action.",
      confirmTone: "primary",
      confirmLabel: "Save settings",
      onConfirm: performSaveUnfollowSettings,
    });
  }

  async function performSaveUnfollowSettings() {
    if (!settings) return;

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const projection = await readApiResponse<UnfollowDomainProjection>(
        await fetch("/api/instagram-dashboard/settings/unfollow", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(unfollowDomainPayload(settings)),
        }),
        "Could not save Unfollow domain settings."
      );
      const savedSettings = withUnfollowDomainProjection(settings, projection);
      setSettings(savedSettings);
      setSettingsBaseline(savedSettings);
      setSuccess("Unfollow domain settings saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save Unfollow domain settings.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateFollowFilter(
    key: "skip_private_profiles" | "min_followers" | "max_followers" | "min_posts",
    value: boolean | number | null,
  ) {
    setFollowFilters((current) => (current ? { ...current, [key]: value } : current));
  }

  function saveFollowFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!followFilters || sameFollowFiltersPayload(followFilters, followFiltersBaseline)) return;
    if (followFiltersValidationError(followFilters)) return;

    requestConfirmation({
      title: "Save Follow filters?",
      description: "This updates the runtime Follow filter policy. It will not start a run.",
      confirmTone: "primary",
      confirmLabel: "Save filters",
      onConfirm: performSaveFollowFilters,
    });
  }

  async function performSaveFollowFilters() {
    if (!followFilters) return;

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const projection = await readApiResponse<FollowFiltersProjection>(
        await fetch("/api/instagram-dashboard/settings/follow-filters", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            account_id: followFilters.account_id,
            skip_private_profiles: followFilters.skip_private_profiles,
            min_followers: followFilters.min_followers,
            max_followers: followFilters.max_followers,
            min_posts: followFilters.min_posts,
          }),
        }),
        "Could not save Follow filter settings.",
      );
      setFollowFilters(projection);
      setFollowFiltersBaseline(projection);
      setSuccess("Follow filter settings saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save Follow filter settings.");
    } finally {
      setIsSaving(false);
    }
  }

  function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!schedule || !scheduleBaseline || !scheduleDirty(schedule, scheduleBaseline, selectedScheduleSlotKey)) return;
    const validationError = scheduleValidationError(schedule, selectedScheduleSlotKey);
    if (validationError) return;

    requestConfirmation({
      title: "Save Schedule assignment?",
      description: "This updates the phone slot assignment for this account. It will not start a run.",
      confirmTone: "primary",
      confirmLabel: "Save Schedule",
      onConfirm: performSaveSchedule,
    });
  }

  async function performSaveSchedule() {
    if (!schedule) return;
    const selectedSlot = findScheduleSlot(schedule, selectedScheduleSlotKey);
    if (!selectedSlot || !schedule.device_id) return;

    setIsSaving(true);
    setError("");
    setSuccess("");

    try {
      const projection = await readApiResponse<ScheduleProjection>(
        await fetch("/api/instagram-dashboard/settings/schedule", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            account_id: schedule.account_id,
            device_id: schedule.device_id,
            starts_at: selectedSlot.starts_at,
            ends_at: selectedSlot.ends_at,
          }),
        }),
        "Could not save Schedule settings.",
      );
      setSchedule(projection);
      setScheduleBaseline(projection);
      setSelectedScheduleSlotKey(scheduleSlotKeyFromAssignment(projection.current_assignment));
      setSuccess("Schedule assignment saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save Schedule settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function stopRun() {
    setError("");
    setSuccess("");

    try {
      const payload = await readApiResponse<{ stopped: boolean; canceled_request?: boolean; message: string }>(
        await fetch("/api/instagram-dashboard/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        }),
        "Could not stop the run."
      );
      setSuccess(payload.message || "Stop request sent.");
      router.refresh();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Could not stop the run.");
    }
  }

  async function startRun() {
    setIsStartingRun(true);
    setError("");
    setSuccess("");

    try {
      const payload = await readApiResponse<RunStartResponse>(
        await fetch("/api/instagram-dashboard/runs/start", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId, requested_run_type: "account_session" }),
        }),
        "Could not start the run."
      );
      setSuccess(runStartSuccessMessage(payload));
      router.refresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the run.");
    } finally {
      setIsStartingRun(false);
    }
  }

  function requestStartRun() {
    requestConfirmation({
      title: "Start manual run?",
      description: "This will request a real worker run through the supervised runtime dispatcher.",
      confirmTone: "primary",
      onConfirm: startRun,
    });
  }

  function requestStopRun() {
    requestConfirmation({
      title: "🚨 Stop current run? ⚠️",
      description: "This will cancel queued run requests and request stop for any active run.",
      confirmTone: "danger",
      onConfirm: stopRun,
    });
  }

  const activeAccountTools = buildActiveAccountTools(runControlHealth, isStartingRun);

  async function updateLifecycle(action: "archive" | "trash" | "restore") {
    setError("");
    setSuccess("");

    try {
      await readApiResponse<Record<string, ConfigValue>>(
        await fetch("/api/instagram-dashboard/accounts/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ account_id: accountId, action }),
        }),
        "Could not update account lifecycle."
      );

      setSuccess(
        action === "archive"
          ? "Account archived."
          : action === "trash"
            ? "Account moved to trash."
            : "Account restored."
      );
      router.refresh();
    } catch (lifecycleError) {
      setError(lifecycleError instanceof Error ? lifecycleError.message : "Could not update account lifecycle.");
    }
  }

  function requestLifecycle(action: "archive" | "trash" | "restore") {
    requestConfirmation({
      title:
        action === "archive"
          ? "🚨 Confirm archive account? ⚠️"
          : action === "trash"
            ? "🚨 Confirm move account to trash? ⚠️"
            : "🚨 Confirm restore account? ⚠️",
      description:
        action === "archive"
          ? "This account will be moved to Archives and scheduled to move to Trash after 30 days."
          : action === "trash"
            ? "This account will be moved to Trash and scheduled for permanent deletion after 30 days."
            : "This account will be restored to Active accounts.",
      confirmTone: action === "restore" ? "primary" : "danger",
      onConfirm: () => updateLifecycle(action),
    });
  }

  const panelTitle =
    panel === "stats"
      ? `Statistics — ${username}`
      : panel === "logs"
        ? `Logs — ${username}`
        : panel === "filters"
          ? `Filters — ${username}`
          : `Settings — ${username}`;

  return (
    <>
      <div className="ig-dashboard-row-tools" aria-label={`Controls for ${username}`}>
        {(mode === "archived" ? archivedAccountTools : mode === "trashed" ? trashedAccountTools : activeAccountTools).map((tool) => (
          <ActionButton
            key={tool.label}
            tool={tool}
            username={username}
            onClick={() => {
              if (tool.disabled) return;
              if (tool.label === "Settings") void loadPanel("settings");
              else if (tool.label === "Stats") void loadPanel("stats");
              else if (tool.label === "Logs") void loadPanel("logs");
              else if (tool.label === "Filters") void loadPanel("filters");
              else if (tool.label === "Targets") setTargetsOpen(true);
              else if (tool.label === "Stop run") requestStopRun();
              else if (tool.label === "Run manually") requestStartRun();
              else if (tool.label === "Archive") requestLifecycle("archive");
              else if (tool.label === "Move to trash") requestLifecycle("trash");
              else if (tool.label === "Restore account") requestLifecycle("restore");
            }}
          />
        ))}
      </div>

      {(error || success) && !panel && (
        <p className={error ? "ig-action-inline ig-action-inline-error" : "ig-action-inline ig-action-inline-success"}>
          {error || success}
        </p>
      )}

      {panel && (
        <div className="ig-settings-overlay" role="presentation" onMouseDown={closePanel}>
          <aside className="ig-settings-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
            <div className="ig-settings-header">
              <div>
                <span>Profile controls</span>
                <h2 id={titleId}>{panelTitle}</h2>
              </div>
              <button type="button" className="ig-settings-icon-button" aria-label="Close panel" onClick={closePanel}>x</button>
            </div>

            {isLoading ? <div className="ig-settings-loading">Loading account data...</div> : null}
            {!isLoading && (panel === "settings" || panel === "filters") && settings && followFilters && schedule
              ? renderSettingsTabs({
                  settings,
                  settingsBaseline,
                  followFilters,
                  followFiltersBaseline,
                  schedule,
                  scheduleBaseline,
                  selectedScheduleSlotKey,
                  setSelectedScheduleSlotKey,
                  settingsTab,
                  selectSettingsTab,
                  updateSetting,
                  updateFollowFilter,
                  saveSettings,
                  saveDmSettings,
                  saveUnfollowSettings,
                  saveFollowFilters,
                  saveSchedule,
                  openSaveTemplate: (source) => setTemplateDialog({ kind: "save", source }),
                  openApplyTemplate: (source) => setTemplateDialog({ kind: "apply", source }),
                  closePanel,
                  isSaving,
                  error,
                  success,
                  targetsOverview,
                  openTargetsPanel: () => setTargetsOpen(true),
                  packageLabel,
                  entitlementSummary,
                })
              : null}
            {!isLoading && panel === "stats" ? renderStats({
              rows: statsRows,
              error,
              success,
              isExporting,
              isMenuOpen: exportMenu === "stats",
              toggleMenu: () => setExportMenu((current) => current === "stats" ? null : "stats"),
              exportStats,
            }) : null}
            {!isLoading && panel === "logs" ? renderLogs({
              logs,
              error,
              success,
              isExporting,
              isMenuOpen: exportMenu === "logs",
              toggleMenu: () => setExportMenu((current) => current === "logs" ? null : "logs"),
              exportLogs,
              copyLogs,
            }) : null}
            {!isLoading && error && (panel === "settings" || panel === "filters") && (!settings || !followFilters || !schedule) ? (
              <div className="ig-settings-loading">
                <p className="ig-settings-message ig-settings-error">{error}</p>
                <button type="button" className="ig-settings-secondary" onClick={closePanel}>Cancel</button>
              </div>
            ) : null}
          </aside>
        </div>
      )}

      <InstagramAccountTargetsPanel
        accountId={accountId}
        accountUsername={username}
        open={targetsOpen}
        onClose={() => setTargetsOpen(false)}
      />

      {confirmation ? (
        <ConfirmationModal
          title={confirmation.title}
          description={confirmation.description}
          confirmTone={confirmation.confirmTone}
          confirmLabel={confirmation.confirmLabel}
          cancelLabel={confirmation.cancelLabel}
          isBusy={isSaving}
          onCancel={closeConfirmation}
          onConfirm={() => void confirmAction()}
        />
      ) : null}

      {templateDialog ? (
        <TemplateDialogModal
          dialog={templateDialog}
          templates={templates}
          isSaving={isSaving}
          onCancel={() => setTemplateDialog(null)}
          onSave={saveTemplate}
          onApply={requestApplyTemplate}
        />
      ) : null}

      {styleReady ? <style>{`
        .ig-action-inline {
          width: 100%;
          margin: 8px 0 0;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 800;
        }

        .ig-action-inline-success {
          border: 1px solid rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-action-inline-error {
          border: 1px solid rgba(248,113,113,0.28);
          background: rgba(248,113,113,0.08);
          color: #FCA5A5;
        }

        .ig-settings-overlay {
          position: fixed;
          inset: 0;
          z-index: 120;
          display: flex;
          justify-content: flex-end;
          background: rgba(2, 6, 23, 0.58);
          backdrop-filter: blur(10px);
        }

        .ig-settings-panel {
          width: min(100%, 760px);
          height: 100vh;
          overflow-y: auto;
          border-left: 1px solid rgba(255,255,255,0.10);
          background: #07111f;
          box-shadow: -24px 0 80px rgba(0,0,0,0.36);
          color: #f0f0ef;
          padding: 24px;
        }

        .ig-settings-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 22px;
        }

        .ig-settings-header span,
        .ig-settings-field span {
          display: block;
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .ig-settings-header h2 {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: clamp(1.35rem, 4vw, 2rem);
          line-height: 1.1;
          margin: 8px 0 0;
        }

        .ig-settings-icon-button {
          width: 36px;
          height: 36px;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 10px;
          background: rgba(255,255,255,0.05);
          color: rgba(255,255,255,0.72);
          cursor: pointer;
          font-size: 22px;
          line-height: 1;
        }

        .ig-settings-form {
          display: grid;
          gap: 16px;
        }

        .ig-settings-tabs {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }

        .ig-settings-tab {
          min-height: 32px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 999px;
          background: rgba(255,255,255,0.035);
          color: rgba(255,255,255,0.58);
          cursor: pointer;
          font-size: 12px;
          font-weight: 800;
          padding: 0 11px;
        }

        .ig-settings-tab-active {
          border-color: rgba(245,158,11,0.40);
          background: rgba(245,158,11,0.14);
          color: #FBBF24;
        }

        .ig-settings-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .ig-settings-field {
          display: grid;
          gap: 8px;
        }

        .ig-settings-field-wide {
          grid-column: 1 / -1;
        }

        .ig-settings-field input,
        .ig-settings-field textarea,
        .ig-settings-field select {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 12px;
          background: rgba(255,255,255,0.045);
          color: #f0f0ef;
          font: inherit;
          outline: none;
          padding: 12px;
        }

        .ig-settings-field textarea {
          resize: vertical;
          line-height: 1.55;
        }

        .ig-settings-toggle-grid,
        .ig-settings-number-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .ig-settings-toggle {
          position: relative;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 4px 10px;
          min-height: 76px;
          padding: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          background: rgba(255,255,255,0.03);
          cursor: pointer;
        }

        .ig-settings-toggle input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }

        .ig-settings-toggle span {
          grid-row: span 2;
          width: 42px;
          height: 24px;
          border-radius: 999px;
          background: rgba(255,255,255,0.10);
          border: 1px solid rgba(255,255,255,0.10);
          transition: background 150ms, border-color 150ms;
        }

        .ig-settings-toggle span::after {
          content: "";
          display: block;
          width: 18px;
          height: 18px;
          margin: 2px;
          border-radius: 999px;
          background: rgba(255,255,255,0.70);
          transition: transform 150ms, background 150ms;
        }

        .ig-settings-toggle input:checked + span {
          background: rgba(245,158,11,0.32);
          border-color: rgba(245,158,11,0.45);
        }

        .ig-settings-toggle input:checked + span::after {
          transform: translateX(18px);
          background: #FBBF24;
        }

        .ig-settings-toggle strong {
          color: #f0f0ef;
          font-size: 13px;
          line-height: 1.25;
        }

        .ig-settings-toggle small {
          color: rgba(255,255,255,0.46);
          font-size: 11.5px;
          line-height: 1.35;
        }

        .ig-settings-control-disabled {
          cursor: not-allowed;
          opacity: 0.62;
        }

        .ig-settings-message {
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          margin: 0;
          padding: 11px 12px;
        }

        .ig-dm-target-panel {
          display: grid;
          gap: 14px;
        }

        .ig-filters-target-panel {
          display: grid;
          gap: 14px;
        }

        .ig-filters-section {
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 18px;
          background: rgba(255,255,255,0.03);
          padding: 14px;
        }

        .ig-filters-section-head h3 {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.02rem;
          margin: 0 0 6px;
        }

        .ig-filters-section-head p {
          color: rgba(255,255,255,0.50);
          font-size: 12px;
          line-height: 1.4;
          margin: 0 0 12px;
        }

        .ig-filters-section-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 6px;
        }

        .ig-filters-badge {
          display: inline-flex;
          align-items: center;
          min-height: 22px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.11);
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .ig-filters-badge-active {
          border-color: rgba(52,211,153,0.28);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-filters-badge-planned {
          border-color: rgba(148,163,184,0.22);
          background: rgba(148,163,184,0.08);
          color: rgba(255,255,255,0.58);
        }

        .ig-filters-section-info {
          opacity: 0.92;
        }

        .ig-filters-planned-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .ig-filters-planned-card {
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          background: rgba(255,255,255,0.02);
          padding: 12px;
        }

        .ig-filters-planned-card p {
          color: rgba(255,255,255,0.48);
          font-size: 11px;
          line-height: 1.35;
          margin: 8px 0 0;
        }

        .ig-filters-planned-card strong {
          color: #f0f0ef;
          font-size: 12px;
        }

        .ig-source-policy-list {
          display: grid;
          gap: 7px;
          margin: 10px 0 0;
          padding: 0;
          list-style: none;
        }

        .ig-source-policy-list li {
          color: rgba(255,255,255,0.56);
          font-size: 11.5px;
          line-height: 1.35;
        }

        .ig-source-policy-list li::before {
          content: "-";
          color: rgba(245,158,11,0.72);
          margin-right: 7px;
        }

        .ig-schedule-assignment-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .ig-schedule-assignment-item {
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 14px;
          background: rgba(255,255,255,0.02);
          padding: 10px 12px;
        }

        .ig-schedule-assignment-item span {
          display: block;
          color: rgba(255,255,255,0.45);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .ig-schedule-assignment-item strong {
          display: block;
          color: #f0f0ef;
          font-size: 12px;
          line-height: 1.35;
          margin-top: 4px;
        }

        .ig-filters-legacy-note {
          margin-top: 4px;
          opacity: 0.72;
        }

        .ig-dm-card {
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 18px;
          background: rgba(255,255,255,0.03);
          padding: 14px;
        }

        .ig-dm-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .ig-dm-card-head {
          margin-bottom: 14px;
        }

        .ig-dm-card-disabled {
          opacity: 0.62;
        }

        .ig-dm-section-kicker {
          display: block;
          color: rgba(251,191,36,0.78);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .ig-dm-card h3 {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.08rem;
          margin: 5px 0 5px;
        }

        .ig-dm-card p {
          color: rgba(255,255,255,0.50);
          font-size: 12px;
          line-height: 1.4;
          margin: 0;
        }

        .ig-dm-service-badge {
          display: inline-flex;
          align-items: center;
          min-height: 26px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.11);
          padding: 3px 9px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .ig-dm-service-active {
          border-color: rgba(52,211,153,0.28);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-dm-service-inactive {
          border-color: rgba(148,163,184,0.22);
          background: rgba(148,163,184,0.08);
          color: rgba(255,255,255,0.58);
        }

        .ig-dm-card-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .ig-dm-preview {
          grid-column: 1 / -1;
          display: grid;
          gap: 8px;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 14px;
          background: rgba(15,23,42,0.42);
          padding: 11px 12px;
        }

        .ig-dm-preview-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-dm-preview-body {
          min-height: 44px;
          color: rgba(255,255,255,0.78);
          font-size: 13px;
          line-height: 1.45;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }

        .ig-dm-preview-empty {
          color: rgba(255,255,255,0.34);
        }

        .ig-dm-preview-warning {
          color: #FCA5A5;
          font-size: 12px;
          font-weight: 800;
        }

        .ig-settings-success {
          border: 1px solid rgba(52,211,153,0.24);
          background: rgba(52,211,153,0.08);
          color: #86EFAC;
        }

        .ig-settings-error {
          border: 1px solid rgba(248,113,113,0.28);
          background: rgba(248,113,113,0.08);
          color: #FCA5A5;
        }

        .ig-settings-loading {
          display: grid;
          gap: 14px;
          min-height: 180px;
          place-items: center;
          color: rgba(255,255,255,0.62);
          text-align: center;
        }

        .ig-settings-actions {
          position: sticky;
          bottom: -24px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin: 6px -24px -24px;
          padding: 16px 24px 24px;
          border-top: 1px solid rgba(255,255,255,0.08);
          background: rgba(7,17,31,0.92);
          backdrop-filter: blur(14px);
        }

        .ig-template-actions {
          display: flex;
          justify-content: flex-start;
          gap: 10px;
          flex-wrap: wrap;
        }

        .ig-settings-primary,
        .ig-settings-secondary {
          min-height: 40px;
          border-radius: 999px;
          padding: 0 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 900;
        }

        .ig-settings-primary {
          border: 1px solid rgba(245,158,11,0.50);
          background: #F59E0B;
          color: #160b02;
        }

        .ig-settings-secondary {
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.045);
          color: rgba(255,255,255,0.76);
        }

        .ig-settings-primary:disabled,
        .ig-settings-secondary:disabled {
          cursor: wait;
          opacity: 0.64;
        }

        .ig-confirm-overlay {
          position: fixed;
          inset: 0;
          z-index: 180;
          display: grid;
          place-items: center;
          padding: 18px;
          background: rgba(2,6,23,0.72);
          backdrop-filter: blur(12px);
        }

        .ig-confirm-modal {
          width: min(100%, 440px);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px;
          background: #07111f;
          box-shadow: 0 24px 90px rgba(0,0,0,0.46);
          color: #f0f0ef;
          padding: 20px;
        }

        .ig-confirm-modal h3 {
          color: #f0f0ef;
          font-family: 'Syne', sans-serif;
          font-size: 1.22rem;
          line-height: 1.25;
          margin: 0 0 10px;
        }

        .ig-confirm-modal p {
          color: rgba(255,255,255,0.62);
          font-size: 13px;
          line-height: 1.6;
          margin: 0;
          white-space: pre-line;
        }

        .ig-confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }

        .ig-confirm-danger {
          border-color: rgba(248,113,113,0.48);
          background: #DC2626;
          color: #fff7f7;
        }

        .ig-template-field {
          display: grid;
          gap: 8px;
          margin-top: 14px;
        }

        .ig-template-field span {
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .ig-template-field input,
        .ig-template-field textarea,
        .ig-template-field select {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 12px;
          background: rgba(255,255,255,0.045);
          color: #f0f0ef;
          font: inherit;
          outline: none;
          padding: 12px;
        }

        .ig-export-bar {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 12px;
        }

        .ig-export-menu-wrap {
          position: relative;
        }

        .ig-export-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 38px;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 999px;
          background: rgba(255,255,255,0.055);
          color: rgba(255,255,255,0.82);
          cursor: pointer;
          font-size: 12px;
          font-weight: 900;
          padding: 0 14px;
        }

        .ig-export-button:disabled {
          cursor: wait;
          opacity: 0.66;
        }

        .ig-export-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 5;
          min-width: 180px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          background: #0b1727;
          box-shadow: 0 18px 46px rgba(0,0,0,0.35);
          padding: 6px;
        }

        .ig-export-menu button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-height: 34px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: rgba(255,255,255,0.74);
          cursor: pointer;
          font-size: 12px;
          font-weight: 800;
          padding: 0 9px;
          text-align: left;
        }

        .ig-export-menu button:hover {
          background: rgba(245,158,11,0.12);
          color: #FBBF24;
        }

        .ig-export-menu button:disabled {
          cursor: wait;
          opacity: 0.58;
        }

        .ig-panel-table-wrap {
          overflow-x: auto;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.025);
        }

        .ig-python-live-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          margin: 0 0 12px;
        }

        .ig-python-live-item {
          min-height: 70px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          padding: 10px;
          background: rgba(255,255,255,0.025);
        }

        .ig-python-live-item span {
          display: block;
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 800;
          line-height: 1.35;
          text-transform: uppercase;
        }

        .ig-python-live-item strong {
          display: block;
          margin-top: 8px;
          color: rgba(255,255,255,0.84);
          font-size: 14px;
          font-weight: 900;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }

        .ig-panel-table {
          width: 100%;
          min-width: 1180px;
          border-collapse: collapse;
        }

        .ig-panel-table th,
        .ig-panel-table td {
          padding: 12px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          text-align: left;
          vertical-align: top;
          font-size: 12px;
        }

        .ig-panel-table th {
          color: rgba(255,255,255,0.42);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ig-panel-table td {
          color: rgba(255,255,255,0.66);
        }

        .ig-source-badge {
          display: inline-flex;
          align-items: center;
          min-height: 22px;
          border: 1px solid rgba(251,191,36,0.24);
          border-radius: 999px;
          padding: 3px 8px;
          background: rgba(251,191,36,0.08);
          color: #FDE68A;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }

        .ig-metadata-cell {
          max-width: 320px;
          font-family: 'JetBrains Mono', monospace;
          line-height: 1.45;
        }

        .ig-panel-empty {
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.025);
          color: rgba(255,255,255,0.54);
          padding: 28px;
          text-align: center;
        }

        @media (max-width: 680px) {
          .ig-settings-panel {
            padding: 18px;
          }

          .ig-python-live-grid {
            grid-template-columns: 1fr;
          }

          .ig-settings-toggle-grid,
          .ig-settings-number-grid,
          .ig-settings-grid,
          .ig-dm-card-grid {
            grid-template-columns: 1fr;
          }

          .ig-dm-card-head {
            display: grid;
          }

          .ig-settings-actions {
            margin: 6px -18px -18px;
            padding: 14px 18px 18px;
          }
        }
      `}</style> : null}
    </>
  );
}

function ActionButton({ tool, username, onClick }: { tool: AccountTool; username: string; onClick: () => void }) {
  const Icon = tool.Icon;
  const toneClass = tool.tone ? `ig-dashboard-tool-${tool.tone}` : "";

  return (
    <button
      type="button"
      className={`ig-dashboard-tool ${toneClass}`.trim()}
      aria-label={`${tool.label} for ${username}`}
      data-tooltip={tool.disabled ? (tool.disabledReason ?? `${tool.label} is not available yet`) : tool.label}
      onClick={onClick}
      disabled={tool.disabled}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={2.2} />
    </button>
  );
}

function ConfirmationModal({
  title,
  description,
  confirmTone,
  confirmLabel = "Confirm action",
  cancelLabel = "Cancel",
  isBusy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmTone: "primary" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="ig-confirm-overlay" role="presentation" onMouseDown={onCancel}>
      <section className="ig-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ig-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <h3 id="ig-confirm-title">{title}</h3>
        <p>{description}</p>
        <div className="ig-confirm-actions">
          <button type="button" className="ig-settings-secondary" onClick={onCancel} disabled={isBusy}>{cancelLabel}</button>
          <button
            type="button"
            className={confirmTone === "danger" ? "ig-settings-primary ig-confirm-danger" : "ig-settings-primary"}
            onClick={onConfirm}
            disabled={isBusy}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function TemplateDialogModal({
  dialog,
  templates,
  isSaving,
  onCancel,
  onSave,
  onApply,
}: {
  dialog: Exclude<TemplateDialog, null>;
  templates: AccountTemplate[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (name: string, description: string, templateType: "settings" | "filters" | "full") => void;
  onApply: (templateId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateType, setTemplateType] = useState<"settings" | "filters" | "full">(dialog.source === "settings" ? "settings" : "filters");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  return (
    <div className="ig-confirm-overlay" role="presentation" onMouseDown={onCancel}>
      <section className="ig-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="ig-template-title" onMouseDown={(event) => event.stopPropagation()}>
        <h3 id="ig-template-title">{dialog.kind === "save" ? "Save as Template" : "Apply Template"}</h3>
        <p>
          {dialog.kind === "save"
            ? "Save this account configuration as a reusable dashboard draft template. Templates replay draft settings, not proven runtime defaults."
            : "Apply a reusable dashboard draft template to this account. Runtime wiring is still pending for fields marked Needs routing."}
        </p>

        {dialog.kind === "save" ? (
          <>
            <label className="ig-template-field">
              <span>Template name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="ig-template-field">
              <span>Description</span>
              <textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="ig-template-field">
              <span>Template type</span>
              <select value={templateType} onChange={(event) => setTemplateType(event.target.value as "settings" | "filters" | "full")}>
                <option value={dialog.source}>{dialog.source}</option>
                <option value="full">full</option>
              </select>
            </label>
          </>
        ) : (
          <label className="ig-template-field">
            <span>Template</span>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name} · {template.template_type}</option>
              ))}
            </select>
          </label>
        )}

        <div className="ig-confirm-actions">
          <button type="button" className="ig-settings-secondary" onClick={onCancel} disabled={isSaving}>Cancel</button>
          {dialog.kind === "save" ? (
            <button type="button" className="ig-settings-primary" onClick={() => onSave(name.trim(), description.trim(), templateType)} disabled={isSaving || !name.trim()}>
              Save Template
            </button>
          ) : (
            <button type="button" className="ig-settings-primary" onClick={() => onApply(templateId)} disabled={isSaving || !templateId}>
              Apply Template
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ExportBar({
  label,
  isExporting,
  isMenuOpen,
  toggleMenu,
  items,
}: {
  label: string;
  isExporting: boolean;
  isMenuOpen: boolean;
  toggleMenu: () => void;
  items: Array<{ label: string; onClick: () => void; Icon?: LucideIcon }>;
}) {
  return (
    <div className="ig-export-bar">
      <div className="ig-export-menu-wrap">
        <button type="button" className="ig-export-button" onClick={toggleMenu} disabled={isExporting}>
          <Download aria-hidden="true" size={15} strokeWidth={2.2} />
          {isExporting ? "Preparing..." : label}
        </button>
        {isMenuOpen ? (
          <div className="ig-export-menu" role="menu">
            {items.map((item) => {
              const Icon = item.Icon ?? Download;
              return (
                <button key={item.label} type="button" role="menuitem" onClick={item.onClick} disabled={isExporting}>
                  <Icon aria-hidden="true" size={14} strokeWidth={2.2} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderSettingsTabs({
  settings,
  settingsBaseline,
  followFilters,
  followFiltersBaseline,
  schedule,
  scheduleBaseline,
  selectedScheduleSlotKey,
  setSelectedScheduleSlotKey,
  settingsTab,
  selectSettingsTab,
  updateSetting,
  updateFollowFilter,
  saveSettings,
  saveDmSettings,
  saveUnfollowSettings,
  saveFollowFilters,
  saveSchedule,
  openSaveTemplate,
  openApplyTemplate,
  closePanel,
  isSaving,
  error,
  success,
  targetsOverview,
  openTargetsPanel,
  packageLabel,
  entitlementSummary,
}: {
  settings: InstagramSettings;
  settingsBaseline: InstagramSettings | null;
  followFilters: FollowFiltersProjection;
  followFiltersBaseline: FollowFiltersProjection | null;
  schedule: ScheduleProjection;
  scheduleBaseline: ScheduleProjection | null;
  selectedScheduleSlotKey: string;
  setSelectedScheduleSlotKey: (value: string) => void;
  settingsTab: SettingsTab;
  selectSettingsTab: (tab: SettingsTab) => void | Promise<void>;
  updateSetting: (key: string, value: ConfigValue) => void;
  updateFollowFilter: (
    key: "skip_private_profiles" | "min_followers" | "max_followers" | "min_posts",
    value: boolean | number | null,
  ) => void;
  saveSettings: (event: FormEvent<HTMLFormElement>) => void;
  saveDmSettings: (event: FormEvent<HTMLFormElement>) => void;
  saveUnfollowSettings: (event: FormEvent<HTMLFormElement>) => void;
  saveFollowFilters: (event: FormEvent<HTMLFormElement>) => void;
  saveSchedule: (event: FormEvent<HTMLFormElement>) => void;
  openSaveTemplate: (source: "settings" | "filters") => void;
  openApplyTemplate: (source: "settings" | "filters") => void;
  closePanel: () => void;
  isSaving: boolean;
  error: string;
  success: string;
  targetsOverview: TargetsOverview | null;
  openTargetsPanel: () => void;
  packageLabel?: string | null;
  entitlementSummary?: string | null;
}) {
  const activeSettingsTab = visibleSettingsTab(settingsTab);
  const isGeneralTab = activeSettingsTab === "General";
  const isFiltersTab = activeSettingsTab === "Filters";
  const fields = settingsFieldsForTab(activeSettingsTab);
  const hasEditableFields = fields.some((field) => !field.readOnly && !field.disabled);
  const isDmTab = activeSettingsTab === "DM";
  const isFollowTab = activeSettingsTab === "Follow";
  const isFollowbackTab = activeSettingsTab === "Followback";
  const isScheduleTab = activeSettingsTab === "Schedule";
  const isSourcesTab = activeSettingsTab === "Sources";
  const showDraftBanner = hasEditableFields && !isDmTab && !isFollowTab && !isFollowbackTab && !isFiltersTab && !isScheduleTab;
  const dmDirty = isDmTab && !sameDmPayload(settings, settingsBaseline);
  const dmValidationError = isDmTab ? dmClientValidationError(settings) : "";
  const unfollowDirty = isFollowbackTab && !sameUnfollowPayload(settings, settingsBaseline);
  const unfollowValidationError = isFollowbackTab ? unfollowClientValidationError(settings) : "";
  const followFiltersDirty = isFiltersTab && !sameFollowFiltersPayload(followFilters, followFiltersBaseline);
  const followFiltersError = isFiltersTab ? followFiltersValidationError(followFilters) : "";
  const scheduleDirtyState = isScheduleTab && scheduleBaseline
    ? scheduleDirty(schedule, scheduleBaseline, selectedScheduleSlotKey)
    : false;
  const scheduleError = isScheduleTab ? scheduleValidationError(schedule, selectedScheduleSlotKey) : "";

  return (
    <form
      className="ig-settings-form"
      onSubmit={
        isDmTab
          ? saveDmSettings
          : isFollowbackTab
            ? saveUnfollowSettings
            : isFiltersTab
              ? saveFollowFilters
              : isScheduleTab
                ? saveSchedule
                : saveSettings
      }
    >
      <div className="ig-settings-tabs" role="tablist" aria-label="Instagram Account settings sections">
        {settingsTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeSettingsTab === tab}
            className={activeSettingsTab === tab ? "ig-settings-tab ig-settings-tab-active" : "ig-settings-tab"}
            onClick={() => void selectSettingsTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {showDraftBanner ? <p className="ig-settings-message">{DRAFT_SETTINGS_BANNER}</p> : null}
      {isScheduleTab ? (
        <p className="ig-settings-message">Schedule assigns this account to a phone slot. Only available slots can be saved.</p>
      ) : null}
      {isFiltersTab ? <p className="ig-settings-message">{FILTERS_PRODUCTION_BANNER}</p> : null}
      {isSourcesTab ? (
        <p className="ig-settings-message">Sources is a read-only runtime summary. Target accounts are managed in Targets.</p>
      ) : null}

      {isGeneralTab ? (
        <GeneralSummaryPanel
          settings={settings}
          schedule={schedule}
          packageLabel={packageLabel}
          entitlementSummary={entitlementSummary}
        />
      ) : isScheduleTab ? (
        <ScheduleActivePanel
          schedule={schedule}
          selectedScheduleSlotKey={selectedScheduleSlotKey}
          setSelectedScheduleSlotKey={setSelectedScheduleSlotKey}
        />
      ) : isDmTab ? (
        <DmTargetPanel
          settings={settings}
          updateSetting={updateSetting}
          packageLabel={packageLabel}
          entitlementSummary={entitlementSummary}
        />
      ) : isFollowbackTab ? (
        <>
          {unfollowValidationError ? <p className="ig-settings-message ig-settings-error">{unfollowValidationError}</p> : null}
          <div className="ig-settings-grid">
            {fields.map((field) => (
              <ConfigField
                key={field.key}
                field={field}
                value={settings[field.key]}
                onChange={(value) => updateSetting(field.key, value)}
              />
            ))}
          </div>
        </>
      ) : isFiltersTab ? (
        <>
          {followFiltersError ? <p className="ig-settings-message ig-settings-error">{followFiltersError}</p> : null}
          <FiltersTargetPanel followFilters={followFilters} updateFollowFilter={updateFollowFilter} />
        </>
      ) : isSourcesTab ? (
        <SourcesPolicyPanel targetsOverview={targetsOverview} openTargetsPanel={openTargetsPanel} />
      ) : (
        <div className="ig-settings-grid">
          {fields.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={settings[field.key]}
              onChange={(value) => updateSetting(field.key, value)}
            />
          ))}
        </div>
      )}

      <FormMessages error={error} success={success} />
      {!isDmTab && !isFollowTab && !isFollowbackTab && !isFiltersTab && !isScheduleTab && hasEditableFields ? (
        <div className="ig-template-actions">
          <button type="button" className="ig-settings-secondary" onClick={() => openSaveTemplate("settings")} disabled={isSaving}>
            Save as Template
          </button>
          <button type="button" className="ig-settings-secondary" onClick={() => openApplyTemplate("settings")} disabled={isSaving}>
            Apply Template
          </button>
        </div>
      ) : null}
      {isDmTab ? (
        <DmTargetActions
          closePanel={closePanel}
          isDirty={dmDirty}
          validationError={dmValidationError}
          isSaving={isSaving}
        />
      ) : isFollowbackTab ? (
        <DomainTargetActions
          closePanel={closePanel}
          isDirty={unfollowDirty}
          validationError={unfollowValidationError}
          isSaving={isSaving}
          label="Save Unfollow settings"
        />
      ) : isFiltersTab ? (
        <DomainTargetActions
          closePanel={closePanel}
          isDirty={followFiltersDirty}
          validationError={followFiltersError}
          isSaving={isSaving}
          label="Save Filters"
        />
      ) : isScheduleTab ? (
        <DomainTargetActions
          closePanel={closePanel}
          isDirty={scheduleDirtyState}
          validationError={scheduleError}
          isSaving={isSaving}
          label="Save Schedule"
          canSubmit={schedule.save_ready}
        />
      ) : (
        <FormActions isSaving={isSaving} closePanel={closePanel} canSubmit={hasEditableFields} />
      )}
    </form>
  );
}

function scheduleSlotReasonLabel(slot: ScheduleSlotProjection) {
  if (slot.available) return "Available";
  if (slot.reason === "occupied") return slot.occupied_by ? `Occupied by @${slot.occupied_by}` : "Occupied";
  if (slot.reason === "phone_rest") return "Fixed blackout";
  if (slot.reason === "outreach_rest_reserved") return "Outreach rest reserved";
  if (slot.reason === "no_app_instance_available") return "No app instance available";
  if (slot.reason === "no_clone_available") return "No clone available";
  if (slot.reason === "current") return "Current slot";
  return "Unavailable";
}

function scheduleGateStatusLabel(status: string, reason: string) {
  return status === "blocked" ? `blocked - ${reason || "unknown"}` : status;
}

function scheduleNextEligibleLabel(schedule: ScheduleProjection) {
  if (schedule.gates.next_eligible_starts_at) return schedule.gates.next_eligible_starts_at;
  if (schedule.gates.reason === "assignment_missing" || !schedule.current_assignment) return "Select a slot first";
  return "None";
}

function summaryValue(value: unknown, fallback = "Not available") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  return fallback;
}

function titleCaseStatus(value: unknown, fallback = "Not available") {
  const raw = summaryValue(value, fallback);
  if (raw === fallback) return raw;
  return raw.replaceAll("_", " ");
}

function GeneralSummaryPanel({
  settings,
  schedule,
  packageLabel,
  entitlementSummary,
}: {
  settings: InstagramSettings;
  schedule: ScheduleProjection;
  packageLabel?: string | null;
  entitlementSummary?: string | null;
}) {
  const appInstanceSummary = schedule.app_instance_availability
    ? `${schedule.app_instance_availability.available} free · ${schedule.app_instance_availability.occupied} occupied · ${schedule.app_instance_availability.disabled + schedule.app_instance_availability.unknown} blocked`
    : "Managed in Schedule";
  const generalSections = [
    {
      title: "Account identity",
      badge: "Read-only",
      items: [
        ["Username", summaryValue(settings.username)],
        ["Display name", summaryValue(settings.display_name)],
      ],
    },
    {
      title: "Package and runtime",
      badge: "Runtime summary",
      items: [
        ["Commercial package", summaryValue(packageLabel || settings.commercial_package_label)],
        ["Add-ons / entitlements", summaryValue(entitlementSummary, "See DM / package tabs")],
        ["Runtime profile", summaryValue(schedule.assignment_type)],
        ["Slot kind", summaryValue(schedule.slot_kind)],
      ],
    },
    {
      title: "Schedule summary",
      badge: "Managed in Schedule",
      items: [
        ["Current slot", schedule.current_assignment?.local_label || "No slot assigned"],
        ["Assignment status", titleCaseStatus(schedule.current_assignment?.status)],
        ["App instances", appInstanceSummary],
      ],
    },
  ];

  return (
    <div className="ig-filters-target-panel">
      <section className="ig-filters-section ig-filters-section-info">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>General summary</h3>
            <span className="ig-filters-badge ig-filters-badge-readonly">Read-only</span>
          </div>
          <p>General is a compact status summary. Operational changes live in Schedule, Follow, DM, Followback, Filters, Credentials, and the Accounts action menu.</p>
        </div>
      </section>

      {generalSections.map((section) => (
        <section key={section.title} className="ig-filters-section">
          <div className="ig-filters-section-head">
            <div className="ig-filters-section-title-row">
              <h3>{section.title}</h3>
              <span className="ig-filters-badge ig-filters-badge-readonly">{section.badge}</span>
            </div>
          </div>
          <div className="ig-schedule-assignment-grid">
            {section.items.map(([label, value]) => (
              <div key={label} className="ig-schedule-assignment-item">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ScheduleActivePanel({
  schedule,
  selectedScheduleSlotKey,
  setSelectedScheduleSlotKey,
}: {
  schedule: ScheduleProjection;
  selectedScheduleSlotKey: string;
  setSelectedScheduleSlotKey: (value: string) => void;
}) {
  const assignment = schedule.current_assignment;
  const expectedSlotKind = assignment?.slot_kind || schedule.slot_kind || schedule.available_slots.find((slot) => slot.slot_kind)?.slot_kind || "Pending assignment";
  const appInstanceSummary = schedule.app_instance_availability
    ? `${schedule.app_instance_availability.available} free · ${schedule.app_instance_availability.occupied} occupied · ${schedule.app_instance_availability.disabled + schedule.app_instance_availability.unknown} blocked`
    : "Pending inventory";
  const assignmentItems = [
    ["Phone / device", schedule.device_label || "Unassigned"],
    ["Runtime profile", schedule.assignment_type || "Unknown"],
    [assignment ? "Slot kind" : "Expected slot kind", assignment ? expectedSlotKind : `${expectedSlotKind} pending assignment`],
    ["Current slot", assignment?.local_label || "No slot assigned"],
    ["App instances", appInstanceSummary],
    ["Assignment status", assignment?.status || "Pending"],
    ["Assignment source", assignment?.assignment_source || "Unknown"],
    ["Device timezone", schedule.device_timezone || "UTC"],
  ];

  return (
    <div className="ig-filters-target-panel">
      <section className="ig-filters-section ig-filters-section-info">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Current assignment</h3>
            <span className={`ig-filters-badge ${schedule.gates.ok ? "ig-filters-badge-active" : "ig-filters-badge-planned"}`}>
              {schedule.gates.ok ? "In window" : "Outside window"}
            </span>
          </div>
          <p>Full-cycle accounts use 6-hour slots. Outreach-only accounts use 40-minute slots.</p>
          {!assignment ? (
            <p className="ig-settings-message">No slot is saved for this account yet. Select an available slot, then Save Schedule to create the assignment.</p>
          ) : null}
        </div>
        <div className="ig-schedule-assignment-grid">
          {assignmentItems.map(([label, value]) => (
            <div key={label} className="ig-schedule-assignment-item">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Select slot</h3>
            <span className={`ig-filters-badge ${schedule.save_ready ? "ig-filters-badge-active" : "ig-filters-badge-planned"}`}>
              {schedule.save_ready ? "Save ready" : "Blocked"}
            </span>
          </div>
          <p>Full-cycle slots stay available unless occupied or blacked out. Outreach rest reservations are planned and disabled unless explicitly configured.</p>
        </div>
        <label className="ig-settings-field">
          <span>Available slot</span>
          <select
            value={selectedScheduleSlotKey}
            onChange={(event) => setSelectedScheduleSlotKey(event.target.value)}
            disabled={!schedule.save_ready}
          >
            <option value="">Select a slot</option>
            {schedule.available_slots.map((slot) => {
              const key = scheduleSlotKey(slot.starts_at, slot.ends_at);
              return (
                <option key={key} value={key} disabled={!slot.available}>
                  {slot.local_label} · {scheduleSlotReasonLabel(slot)}
                </option>
              );
            })}
          </select>
        </label>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Fixed blackout windows</h3>
            <span className="ig-filters-badge ig-filters-badge-planned">
              {schedule.rest_windows.length ? "Active blackout" : "No blackout"}
            </span>
          </div>
          <p>These are explicit maintenance or ops blackout windows. Natural rest happens after a run finishes early.</p>
        </div>
        {schedule.rest_windows.length ? (
          <ul className="ig-source-policy-list">
            {schedule.rest_windows.map((window) => (
              <li key={window.id}>
                {window.weekday === null ? "Daily" : `Weekday ${window.weekday}`}: {window.local_start_time} - {window.local_end_time} ({window.timezone})
                {window.reason ? ` · ${window.reason}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ig-settings-message">No active fixed blackout windows configured for this device.</p>
        )}
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Schedule gates</h3>
            <span className="ig-filters-badge ig-filters-badge-readonly">Runtime</span>
          </div>
        </div>
        <div className="ig-schedule-assignment-grid">
          {[
            ["/runs/start", scheduleGateStatusLabel(schedule.gates.run_start_gate, schedule.gates.reason)],
            ["Dispatcher", scheduleGateStatusLabel(schedule.gates.dispatcher_gate, schedule.gates.reason)],
            ["Auto Restart", scheduleGateStatusLabel(schedule.gates.auto_restart_gate, schedule.gates.reason)],
            ["Gate reason", schedule.gates.reason || "assignment_missing"],
            ["Next eligible slot", scheduleNextEligibleLabel(schedule)],
          ].map(([label, value]) => (
            <div key={label} className="ig-schedule-assignment-item">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function activeTargetCount(items: TargetAccountItem[]) {
  return items.filter((item) => {
    if (isArchivedOrDeletedTarget(item)) return false;
    const status = item.status.toLowerCase();
    return status === "valid" || status === "active";
  }).length;
}

function pendingTargetCount(items: TargetAccountItem[]) {
  return items.filter((item) => {
    if (isArchivedOrDeletedTarget(item)) return false;
    const status = item.status.toLowerCase();
    const verification = item.verificationStatus.toLowerCase();
    return (
      status === "pending" ||
      status === "queued" ||
      status === "pending_verification" ||
      status === "review" ||
      verification === "pending" ||
      item.qualityStatus === "unknown" ||
      item.qualityStatus.startsWith("review_")
    );
  }).length;
}

function sourceMetricCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function SourcesPolicyPanel({
  targetsOverview,
  openTargetsPanel,
}: {
  targetsOverview: TargetsOverview | null;
  openTargetsPanel: () => void;
}) {
  const items = targetsOverview?.items ?? [];
  const eligibleTargets = items.filter(isValidEligibleTarget);
  const nextTarget = eligibleTargets[0] ?? null;
  const fbrTargets = items.filter((item) => !isArchivedOrDeletedTarget(item) && item.fbrPercent !== null);
  const followsSentTargets = items.filter((item) => !isArchivedOrDeletedTarget(item) && item.followsSent !== null);
  const avgFbr = fbrTargets.length
    ? fbrTargets.reduce((total, item) => total + (item.fbrPercent ?? 0), 0) / fbrTargets.length
    : null;
  const targetCountItems = [
    ["Total target accounts", targetsOverview ? String(targetsOverview.summary.total) : "Managed in Targets"],
    ["Active targets", targetsOverview ? String(activeTargetCount(items)) : "Managed in Targets"],
    ["Eligible targets", targetsOverview ? String(targetsOverview.summary.validEligible) : "Managed in Targets"],
    ["Pending / queued", targetsOverview ? String(pendingTargetCount(items)) : "Managed in Targets"],
    ["Archived", targetsOverview ? String(targetsOverview.summary.archivedCount) : "Managed in Targets"],
  ];
  const runtimeItems = [
    ["Current Follow runtime", "Single source"],
    ["Next target probable", nextTarget ? `@${nextTarget.targetUsername}` : targetsOverview ? "No eligible target in DB" : "Managed in Targets"],
    ["Config fallback", "Worker env fallback is not exposed here"],
    ["Multi-target rotation", "Not active yet"],
    ["Switch on exhaustion", "Not active yet"],
  ];
  const performanceItems = [
    ["Followback ratio by target", avgFbr === null ? "pending runtime data" : `${targetFbrLabel(avgFbr)} avg across ${sourceMetricCount(fbrTargets.length, "target", "targets")}`],
    ["Follows sent by target", followsSentTargets.length ? `Available on ${sourceMetricCount(followsSentTargets.length, "target", "targets")}` : "pending runtime data"],
    ["Auto-archive rule", "Planned: flag/archive if ratio <= 8% after at least 100 follows sent"],
    ["Performance verdicts", "Not shown until runtime metrics are reliable"],
  ];

  return (
    <div className="ig-filters-target-panel">
      <section className="ig-filters-section ig-filters-section-info">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Follow sources / Target policy</h3>
            <span className="ig-filters-badge ig-filters-badge-readonly">Read-only</span>
          </div>
          <p>Follow sources are managed in Targets. This panel summarizes runtime readiness only.</p>
        </div>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Current Follow source</h3>
            <span className="ig-filters-badge ig-filters-badge-planned">Runtime partial</span>
          </div>
          <p>The worker Follow session still consumes one primary source per run. Multi-target rotation is not active yet.</p>
        </div>
        <div className="ig-schedule-assignment-grid">
          {runtimeItems.map(([label, value]) => (
            <div key={label} className="ig-schedule-assignment-item">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {targetsOverview && !nextTarget ? (
          <p className="ig-settings-message">If a worker env fallback is configured, it can still force a single source even when no eligible DB target is shown here.</p>
        ) : null}
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Target accounts / Sources</h3>
            <span className="ig-filters-badge ig-filters-badge-readonly">Managed in Targets</span>
          </div>
          <p>Counts come from real target account rows when the Targets API is available. Add, archive, restore, and verify stay in Targets.</p>
        </div>
        <div className="ig-schedule-assignment-grid">
          {targetCountItems.map(([label, value]) => (
            <div key={label} className="ig-schedule-assignment-item">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="ig-settings-actions">
          <button type="button" className="ig-settings-secondary" onClick={openTargetsPanel}>
            Open Targets
          </button>
        </div>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Scroll / exhaustion rules</h3>
            <span className="ig-filters-badge ig-filters-badge-readonly">Runtime read-only</span>
          </div>
          <p>Current behavior stops the session/source when no candidates are found. Switching to the next source is not active.</p>
        </div>
        <ul className="ig-source-policy-list">
          <li>Current behavior: stop session / stop source when no followable candidates remain.</li>
          <li>Source exhaustion reasons are worker logs, not editable dashboard policy.</li>
          <li>Switch to next source: not active.</li>
        </ul>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Followback ratio / Target performance</h3>
            <span className="ig-filters-badge ig-filters-badge-planned">Metrics pending</span>
          </div>
          <p>Performance data stays pending until the worker reliably writes per-target runtime metrics.</p>
        </div>
        <div className="ig-schedule-assignment-grid">
          {performanceItems.map(([label, value]) => (
            <div key={label} className="ig-schedule-assignment-item">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Future source policy</h3>
            <span className="ig-filters-badge ig-filters-badge-planned">Planned</span>
          </div>
          <p>Future worker/API patches will own source selection and rotation rules.</p>
        </div>
        <ul className="ig-source-policy-list">
          <li>Rotate sources and max targets per run.</li>
          <li>Switch after no candidates and mark source exhausted.</li>
          <li>Attribution by target for every follow.</li>
          <li>Followback ratio by target with threshold-based archive/flag.</li>
        </ul>
        <p className="ig-settings-message">Outreach sources are managed in DM/Outreach.</p>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Runtime readiness gate</h3>
            <span className="ig-filters-badge ig-filters-badge-planned">Required before ready</span>
          </div>
          <p>Multi-target Follow stays not runtime-ready until a controlled test run proves selection, target attribution, exhaustion switch, per-target metrics, dashboard reflection, and no Follow regression.</p>
        </div>
      </section>

      <p className="ig-settings-message ig-filters-legacy-note">Legacy Sources controls hidden. No Sources save action is available.</p>
    </div>
  );
}

function FiltersTargetPanel({
  followFilters,
  updateFollowFilter,
}: {
  followFilters: FollowFiltersProjection;
  updateFollowFilter: (
    key: "skip_private_profiles" | "min_followers" | "max_followers" | "min_posts",
    value: boolean | number | null,
  ) => void;
}) {
  return (
    <div className="ig-filters-target-panel">
      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <div className="ig-filters-section-title-row">
            <h3>Runtime-ready Follow filters</h3>
            <span className="ig-filters-badge ig-filters-badge-active">Runtime active</span>
          </div>
          <p>These settings are applied by the worker before a follow attempt.</p>
        </div>
        <div className="ig-settings-grid">
          <ConfigField
            field={{
              key: "skip_private_profiles",
              label: "Skip private profiles",
              type: "toggle",
              runtimeStatus: "active",
              helper: "When enabled, private accounts are skipped during Follow.",
            }}
            value={followFilters.skip_private_profiles}
            onChange={(value) => updateFollowFilter("skip_private_profiles", Boolean(value))}
          />
          <NullableNumberFilterField
            label="Min followers"
            value={followFilters.min_followers}
            helper="Off when empty. Candidates below this follower count are skipped."
            onChange={(value) => updateFollowFilter("min_followers", value)}
          />
          <NullableNumberFilterField
            label="Max followers"
            value={followFilters.max_followers}
            helper="Off when empty. Candidates above this follower count are skipped."
            onChange={(value) => updateFollowFilter("max_followers", value)}
          />
          <NullableNumberFilterField
            label="Min posts"
            value={followFilters.min_posts}
            helper="Off when empty. Candidates below this post count are skipped."
            onChange={(value) => updateFollowFilter("min_posts", value)}
          />
        </div>
      </section>

      <section className="ig-filters-section ig-filters-section-info">
        <div className="ig-filters-section-head">
          <h3>Automatic runtime protections</h3>
          <p>Already interacted accounts, accounts already followed, and interaction blacklist status are enforced automatically.</p>
        </div>
      </section>

      <section className="ig-filters-section">
        <div className="ig-filters-section-head">
          <h3>Planned filters</h3>
          <p>These groups will become configurable after worker and domain wiring is complete.</p>
        </div>
        <div className="ig-filters-planned-grid">
          {plannedFilterCards.map((card) => (
            <div key={card.title} className="ig-filters-planned-card">
              <div className="ig-filters-section-title-row">
                <strong>{card.title}</strong>
                <span className="ig-filters-badge ig-filters-badge-planned">Planned</span>
              </div>
              <p>{card.description}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="ig-settings-message ig-filters-legacy-note">Legacy draft filters hidden.</p>
    </div>
  );
}

function NullableNumberFilterField({
  label,
  value,
  helper,
  onChange,
}: {
  label: string;
  value: number | null;
  helper: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="ig-settings-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
      <small>{helper}</small>
    </label>
  );
}

function DmTargetPanel({
  settings,
  updateSetting,
  packageLabel,
  entitlementSummary,
}: {
  settings: InstagramSettings;
  updateSetting: (key: string, value: ConfigValue) => void;
  packageLabel?: string | null;
  entitlementSummary?: string | null;
}) {
  const availability = getDmServiceAvailability({
    packageLabel,
    entitlementSummary,
    welcomeEntitlementStatus: settingString(settings, "welcome_entitlement_status"),
    welcomeEnabled: settingBoolean(settings, "welcome_dm_runtime_enabled"),
    welcomeTemplateStatus: settingString(settings, "welcome_dm_template_status"),
    outreachEntitlementStatus: settingString(settings, "outreach_entitlement_status"),
    outreachEnabled: settingBoolean(settings, "outreach_dm_runtime_enabled"),
    outreachTemplateStatus: settingString(settings, "outreach_dm_template_status"),
  });
  const welcomeReason = dmDisabledReasonLabel(availability.welcomeDisabledReason);
  const outreachReason = dmDisabledReasonLabel(availability.outreachDisabledReason);
  const validationError = dmClientValidationError(settings);

  return (
    <div className="ig-dm-target-panel">
      {validationError ? <p className="ig-settings-message ig-settings-error">{validationError}</p> : null}
      <section className={availability.welcomeServiceActive ? "ig-dm-card" : "ig-dm-card ig-dm-card-disabled"}>
        <div className="ig-dm-card-head">
          <div>
            <span className="ig-dm-section-kicker">Welcome DM</span>
            <h3>Welcome</h3>
            {!availability.welcomeServiceActive && welcomeReason ? <p>{welcomeReason}</p> : null}
          </div>
          <span className={availability.welcomeServiceActive ? "ig-dm-service-badge ig-dm-service-active" : "ig-dm-service-badge ig-dm-service-inactive"}>
            {availability.welcomeServiceActive ? "Service active" : "Service inactive"}
          </span>
        </div>

        <div className="ig-dm-card-grid">
          <ConfigField
            field={{
              key: "welcome_dm_runtime_enabled",
              label: "Welcome DM enabled",
              type: "toggle",
              hideStateText: true,
              disabled: !availability.welcomeServiceActive,
            }}
            value={settingBoolean(settings, "welcome_dm_runtime_enabled", settingBoolean(settings, "welcome_dm_enabled"))}
            onChange={(value) => updateSetting("welcome_dm_runtime_enabled", value)}
          />
          <ConfigField
            field={{
              key: "welcome_dm_effective_cap",
              label: "Welcome cap/session",
              type: "number",
              min: 0,
              disabled: !availability.welcomeServiceActive,
            }}
            value={settingNumber(settings, "welcome_dm_effective_cap", 0)}
            onChange={(value) => updateSetting("welcome_dm_effective_cap", value)}
          />
          <ConfigField
            field={{
              key: "welcome_dm_effective_day_cap",
              label: "Welcome day cap",
              type: "number",
              min: 0,
              disabled: !availability.welcomeServiceActive,
            }}
            value={settingNumber(settings, "welcome_dm_effective_day_cap", DEFAULT_WELCOME_DM_DAY_CAP)}
            onChange={(value) => updateSetting("welcome_dm_effective_day_cap", value)}
          />
          <ConfigField
            field={{
              key: "welcome_dm_message",
              label: "Welcome DM message",
              type: "textarea",
              disabled: !availability.welcomeServiceActive,
            }}
            value={settingString(settings, "welcome_dm_message")}
            onChange={(value) => updateSetting("welcome_dm_message", value)}
          />
          <DmInstagramPreview label="Welcome" value={settingString(settings, "welcome_dm_message")} />
        </div>
      </section>

      <section className={availability.outreachServiceActive ? "ig-dm-card" : "ig-dm-card ig-dm-card-disabled"}>
        <div className="ig-dm-card-head">
          <div>
            <span className="ig-dm-section-kicker">Outreach DM</span>
            <h3>Outreach</h3>
            {!availability.outreachServiceActive && outreachReason ? <p>{outreachReason}</p> : null}
          </div>
          <span className={availability.outreachServiceActive ? "ig-dm-service-badge ig-dm-service-active" : "ig-dm-service-badge ig-dm-service-inactive"}>
            {availability.outreachServiceActive ? "Service active" : "Service inactive"}
          </span>
        </div>

        <div className="ig-dm-card-grid">
          <ConfigField
            field={{
              key: "outreach_dm_runtime_enabled",
              label: "Outreach enabled",
              type: "toggle",
              hideStateText: true,
              disabled: !availability.outreachServiceActive,
            }}
            value={settingBoolean(settings, "outreach_dm_runtime_enabled", settingBoolean(settings, "cold_dm_enabled"))}
            onChange={(value) => updateSetting("outreach_dm_runtime_enabled", value)}
          />
          <ConfigField
            field={{
              key: "outreach_dm_effective_session_cap",
              label: "Outreach session cap",
              type: "number",
              min: 0,
              disabled: !availability.outreachServiceActive,
            }}
            value={settingNumber(settings, "outreach_dm_effective_session_cap", 0)}
            onChange={(value) => updateSetting("outreach_dm_effective_session_cap", value)}
          />
          <ConfigField
            field={{
              key: "outreach_dm_effective_day_cap",
              label: "Outreach day cap",
              type: "number",
              min: 0,
              disabled: !availability.outreachServiceActive,
            }}
            value={settingNumber(settings, "outreach_dm_effective_day_cap", 0)}
            onChange={(value) => updateSetting("outreach_dm_effective_day_cap", value)}
          />
          <ConfigField
            field={{
              key: "cold_dm_message",
              label: "Outreach DM message",
              type: "textarea",
              disabled: !availability.outreachServiceActive,
            }}
            value={settingString(settings, "cold_dm_message")}
            onChange={(value) => updateSetting("cold_dm_message", value)}
          />
          <DmInstagramPreview label="Outreach" value={settingString(settings, "cold_dm_message")} />
        </div>
      </section>
    </div>
  );
}

function DmInstagramPreview({ label, value }: { label: "Welcome" | "Outreach"; value: string }) {
  const normalized = normalizeDmTemplateMessage(value);
  const lengthError = dmTemplateLengthError(label, normalized);
  return (
    <div className="ig-dm-preview" aria-label={`${label} Instagram preview`}>
      <div className="ig-dm-preview-head">
        <span>Instagram preview</span>
        <span>{normalized.length}/{DM_TEMPLATE_MESSAGE_MAX_CHARS} chars · {dmTemplateLineCount(normalized)} lines</span>
      </div>
      <div className={normalized ? "ig-dm-preview-body" : "ig-dm-preview-body ig-dm-preview-empty"}>
        {normalized || "Message preview will appear here."}
      </div>
      {lengthError ? <div className="ig-dm-preview-warning">{lengthError}</div> : null}
    </div>
  );
}

function DmTargetActions({
  closePanel,
  isDirty,
  validationError,
  isSaving,
}: {
  closePanel: () => void;
  isDirty: boolean;
  validationError: string;
  isSaving: boolean;
}) {
  return (
    <div className="ig-settings-actions">
      <button type="button" className="ig-settings-secondary" onClick={closePanel} disabled={isSaving}>Close</button>
      <button type="submit" className="ig-settings-primary" disabled={isSaving || !isDirty || Boolean(validationError)}>
        {isSaving ? "Saving..." : "Save DM settings"}
      </button>
    </div>
  );
}

function DomainTargetActions({
  closePanel,
  isDirty,
  validationError,
  isSaving,
  label,
  canSubmit = true,
}: {
  closePanel: () => void;
  isDirty: boolean;
  validationError: string;
  isSaving: boolean;
  label: string;
  canSubmit?: boolean;
}) {
  return (
    <div className="ig-settings-actions">
      <button type="button" className="ig-settings-secondary" onClick={closePanel} disabled={isSaving}>Close</button>
      <button type="submit" className="ig-settings-primary" disabled={isSaving || !isDirty || Boolean(validationError) || !canSubmit}>
        {isSaving ? "Saving..." : label}
      </button>
    </div>
  );
}

function renderStats({
  rows,
  error,
  success,
  isExporting,
  isMenuOpen,
  toggleMenu,
  exportStats,
}: {
  rows: StatsRow[];
  error: string;
  success: string;
  isExporting: boolean;
  isMenuOpen: boolean;
  toggleMenu: () => void;
  exportStats: (format: "csv" | "json") => void;
}) {
  if (error) return <p className="ig-settings-message ig-settings-error">{error}</p>;
  const latestPythonRun = rows.find((row) => row.worker_type === "python_uiautomator");

  return (
    <>
      <ExportBar
        label="Export Stats"
        isExporting={isExporting}
        isMenuOpen={isMenuOpen}
        toggleMenu={toggleMenu}
        items={[
          { label: "CSV", onClick: () => exportStats("csv") },
          { label: "JSON", onClick: () => exportStats("json") },
        ]}
      />
      {success ? <p className="ig-settings-message ig-settings-success">{success}</p> : null}
      {latestPythonRun ? (
        <div className="ig-python-live-grid" aria-label="Latest Python worker analytics">
          {[
            ["Latest Python run status", latestPythonRun.status || "—"],
            ["Latest target processed", latestPythonRun.latest_target_username || "—"],
            ["Total duration", formatMs(latestPythonRun.total_ms)],
            ["Row detection time", formatMs(latestPythonRun.row_detect_ms)],
            ["Profile verification time", formatMs(latestPythonRun.profile_verify_ms)],
            ["Warm session", yesNo(Boolean(latestPythonRun.warm_session_used))],
            ["XML fetches", `${latestPythonRun.xml_fetches ?? 0}`],
            ["Worker type", workerSourceLabel(latestPythonRun.worker_type)],
          ].map(([label, value]) => (
            <div className="ig-python-live-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {!rows.length ? <div className="ig-panel-empty">No statistics found.</div> : (
      <div className="ig-panel-table-wrap">
        <table className="ig-panel-table">
          <thead>
            <tr>
              {["Session time", "Source", "Status", "Latest target", "Followers", "Followings", "Follow back enabled", "Like back enabled", "Follow", "Unfollow", "Like", "Comment", "DM", "Watch", "Total interactions", "Total ms", "Typing ms", "Row detect ms", "Row tap ms", "Profile wait ms", "Profile verify ms", "Warm session", "Force stop", "XML fetches", "Recovery", "Exit code"].map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.session_time || "—"}</td>
                <td><span className="ig-source-badge">{workerSourceLabel(row.worker_type)}</span></td>
                <td>{row.status || "—"}</td>
                <td>{row.latest_target_username || "—"}</td>
                <td>{row.followers ?? 0}</td>
                <td>{row.followings ?? 0}</td>
                <td>{boolText(row.follow_back_enabled)}</td>
                <td>{boolText(row.like_back_enabled)}</td>
                <td>{row.follow ?? 0}</td>
                <td>{row.unfollow ?? 0}</td>
                <td>{row.like ?? 0}</td>
                <td>{row.comment ?? 0}</td>
                <td>{row.dm ?? 0}</td>
                <td>{row.watch ?? 0}</td>
                <td>{row.total_interactions ?? 0}</td>
                <td>{row.total_ms ?? 0}</td>
                <td>{row.typing_command_ms ?? 0}</td>
                <td>{row.row_detect_ms ?? 0}</td>
                <td>{row.row_tap_command_ms ?? 0}</td>
                <td>{row.profile_transition_wait_ms ?? 0}</td>
                <td>{row.profile_verify_ms ?? 0}</td>
                <td>{yesNo(Boolean(row.warm_session_used))}</td>
                <td>{yesNo(Boolean(row.force_stop_used))}</td>
                <td>{row.xml_fetches ?? 0}</td>
                <td>{yesNo(Boolean(row.recovery_used))}</td>
                <td>{row.exit_code || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}

function renderLogs({
  logs,
  error,
  success,
  isExporting,
  isMenuOpen,
  toggleMenu,
  exportLogs,
  copyLogs,
}: {
  logs: LogRow[];
  error: string;
  success: string;
  isExporting: boolean;
  isMenuOpen: boolean;
  toggleMenu: () => void;
  exportLogs: (format: "txt" | "json", scope: LogExportScope) => void;
  copyLogs: () => void;
}) {
  if (error) return <p className="ig-settings-message ig-settings-error">{error}</p>;

  return (
    <>
      <ExportBar
        label="Export Logs"
        isExporting={isExporting}
        isMenuOpen={isMenuOpen}
        toggleMenu={toggleMenu}
        items={[
          { label: "Export all logs TXT", onClick: () => exportLogs("txt", "all") },
          { label: "Export all logs JSON", onClick: () => exportLogs("json", "all") },
          { label: "Export latest run TXT", onClick: () => exportLogs("txt", "latest-run") },
          { label: "Export latest run JSON", onClick: () => exportLogs("json", "latest-run") },
          { label: "Export latest Python run TXT", onClick: () => exportLogs("txt", "latest-python-run") },
          { label: "Export latest Python run JSON", onClick: () => exportLogs("json", "latest-python-run") },
          { label: "Copy to clipboard", onClick: copyLogs, Icon: Clipboard },
        ]}
      />
      {success ? <p className="ig-settings-message ig-settings-success">{success}</p> : null}
      {!logs.length ? <div className="ig-panel-empty">No logs found.</div> : (
      <div className="ig-panel-table-wrap">
        <table className="ig-panel-table">
          <thead>
            <tr>
              {["Created at", "Run ID", "Source", "Target username", "Action type", "Status", "Message", "Metadata"].map((heading) => (
                <th key={heading}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.created_at}</td>
                <td>{log.run_id}</td>
                <td><span className="ig-source-badge">{workerSourceLabel(log.worker_type)}</span></td>
                <td>{log.target_username}</td>
                <td>{log.action_type}</td>
                <td>{log.status}</td>
                <td>{log.message}</td>
                <td className="ig-metadata-cell">{compactMetadata(logPerformanceSummary(log))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}

function ConfigField({ field, value, onChange }: { field: FieldSpec; value: ConfigValue | undefined; onChange: (value: ConfigValue) => void }) {
  const helper = buildFieldHelper(field);
  const disabled = field.readOnly || field.disabled;

  if (field.type === "toggle") {
    const checked = Boolean(value);
    return (
      <label className={disabled ? "ig-settings-toggle ig-settings-control-disabled" : "ig-settings-toggle"}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span aria-hidden="true" />
        <strong>{field.label}</strong>
        {field.hideStateText ? null : <small>{helper ?? (checked ? "Enabled" : "Disabled")}</small>}
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label className="ig-settings-field ig-settings-field-wide">
        <span>{field.label}</span>
        <textarea value={String(value ?? "")} rows={4} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        {helper ? <small>{helper}</small> : null}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="ig-settings-field">
        <span>{field.label}</span>
        <select value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option} disabled={field.disabledOptions?.includes(option)}>
              {field.optionLabels?.[option] ?? option}
            </option>
          ))}
        </select>
        {helper ? <small>{helper}</small> : null}
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label className="ig-settings-field">
        <span>{field.label}</span>
        <input
          type="number"
          min={field.min ?? 0}
          step={field.step ?? 1}
          value={Number(value ?? 0)}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {helper ? <small>{helper}</small> : null}
      </label>
    );
  }

  return (
    <label className="ig-settings-field">
      <span>{field.label}</span>
      <input
        type={field.type === "password" ? "password" : field.type === "time" ? "time" : field.type === "date" ? "date" : "text"}
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {helper ? <small>{helper}</small> : null}
    </label>
  );
}

function FormMessages({ error, success }: { error: string; success: string }) {
  return (
    <>
      {error ? <p className="ig-settings-message ig-settings-error">{error}</p> : null}
      {success ? <p className="ig-settings-message ig-settings-success">{success}</p> : null}
    </>
  );
}

function FormActions({ isSaving, closePanel, canSubmit = true }: { isSaving: boolean; closePanel: () => void; canSubmit?: boolean }) {
  return (
    <div className="ig-settings-actions">
      <button type="button" className="ig-settings-secondary" onClick={closePanel} disabled={isSaving}>{canSubmit ? "Cancel" : "Close"}</button>
      {canSubmit ? <button type="submit" className="ig-settings-primary" disabled={isSaving}>{isSaving ? "Saving..." : "Save"}</button> : null}
    </div>
  );
}
