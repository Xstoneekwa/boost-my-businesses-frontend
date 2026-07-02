export type AutoRestartOperationalState = "disabled" | "blocked" | "ready" | "active";

export type AutoRestartPilotValidationInput = {
  accountId: string | null;
  scheduleMode?: string;
  deviceId?: string;
  appInstanceId?: string;
  hasActiveRun?: boolean;
  hasActiveRequest?: boolean;
  restartEligible?: boolean;
  blockReason?: string;
};

export function normalizePilotAccountId(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized;
}

export function pilotAllowlistMismatchReason(candidateAccountId: string, pilotAccountId: string | null) {
  if (!pilotAccountId) return "pilot_allowlist_missing";
  if (candidateAccountId !== pilotAccountId) return "pilot_allowlist_mismatch";
  return null;
}

export function validatePilotSelection(input: AutoRestartPilotValidationInput): string | null {
  const accountId = normalizePilotAccountId(input.accountId);
  if (!accountId) return "pilot_account_missing";

  const scheduleMode = String(input.scheduleMode || "").trim().toLowerCase();
  if (scheduleMode === "manual_only") return "pilot_manual_only_forbidden";

  if (!String(input.deviceId || "").trim() || !String(input.appInstanceId || "").trim()) {
    return "pilot_assignment_device_missing";
  }

  if (input.hasActiveRun) return "pilot_active_run_exists";
  if (input.hasActiveRequest) return "pilot_active_request_exists";

  return null;
}

export function validatePilotForActivation(input: AutoRestartPilotValidationInput): string | null {
  const selectionReason = validatePilotSelection(input);
  if (selectionReason) return selectionReason;

  if (input.restartEligible === false) {
    return input.blockReason ? `pilot_not_eligible:${input.blockReason}` : "pilot_not_eligible";
  }

  return null;
}

export function computeAutoRestartOperationalState(input: {
  enabled: boolean;
  mode: string;
  foundationReady: boolean;
  tickTokenConfigured: boolean;
  pilotAccountId: string | null;
  pilotValidationReason: string | null;
  activationBlockReasons?: string[];
}): { state: AutoRestartOperationalState; blockReasons: string[] } {
  const blockReasons = [...(input.activationBlockReasons || [])];

  if (!input.foundationReady) blockReasons.push("auto_restart_foundation_not_deployed");
  if (input.enabled && input.mode === "active" && !input.tickTokenConfigured) {
    blockReasons.push("active_mode_tick_token_not_configured");
  }
  if (input.pilotValidationReason) blockReasons.push(input.pilotValidationReason);
  if (input.enabled && input.mode === "active" && !input.pilotAccountId) {
    blockReasons.push("pilot_allowlist_missing");
  }

  const unique = [...new Set(blockReasons.filter(Boolean))];
  if (!input.enabled || input.mode === "disabled") {
    return { state: "disabled", blockReasons: unique };
  }
  if (input.mode === "active" && unique.length === 0) {
    return { state: "active", blockReasons: [] };
  }
  if (unique.length > 0) {
    return { state: "blocked", blockReasons: unique };
  }
  return { state: "ready", blockReasons: [] };
}

export function restartDelayBlockReason(nextRestartAt: string | null, now: Date) {
  if (!nextRestartAt) return null;
  const next = new Date(nextRestartAt);
  if (Number.isNaN(next.getTime())) return null;
  if (next.getTime() > now.getTime()) return "restart_delay_not_elapsed";
  return null;
}

export function maxAttemptsBlockReason(currentAttempt: string, maxAttemptsPerSession: number) {
  if (maxAttemptsPerSession <= 0) return null;
  const parsed = Number.parseInt(String(currentAttempt || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed >= maxAttemptsPerSession) return "max_attempts_per_session";
  return null;
}

type SupabaseLike = {
  from: (table: string) => {
    select: (...args: unknown[]) => unknown;
  };
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<{ data?: Record<string, unknown> | null; error?: { message?: string } | null }>;
  limit: (...args: unknown[]) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

const ACTIVE_RUN_STATUSES = ["running", "queued", "pending", "in_progress", "active", "starting"];
const ACTIVE_REQUEST_STATUSES = ["queued", "claimed", "starting", "running", "active", "pending", "processing"];

export async function loadPilotValidationContext(
  supabase: SupabaseLike,
  accountId: string | null,
): Promise<AutoRestartPilotValidationInput> {
  const normalized = normalizePilotAccountId(accountId);
  if (!normalized) {
    return { accountId: null };
  }

  const [assignmentResult, runsResult, requestsResult] = await Promise.all([
    query(supabase, "account_assignments")
      .select("account_id,schedule_mode,device_id,app_instance_id,status,starts_at,ends_at")
      .eq("account_id", normalized)
      .in("status", ["pending", "reserved", "active"])
      .maybeSingle(),
    query(supabase, "ig_runs")
      .select("id,status")
      .eq("account_id", normalized)
      .in("status", ACTIVE_RUN_STATUSES)
      .limit(1),
    query(supabase, "account_run_requests")
      .select("id,status")
      .eq("account_id", normalized)
      .in("status", ACTIVE_REQUEST_STATUSES)
      .limit(1),
  ]);

  const assignment = (assignmentResult.data ?? null) as Record<string, unknown> | null;
  const runs = Array.isArray(runsResult.data) ? runsResult.data : [];
  const requests = Array.isArray(requestsResult.data) ? requestsResult.data : [];

  return {
    accountId: normalized,
    scheduleMode: readString(assignment?.schedule_mode),
    deviceId: readString(assignment?.device_id),
    appInstanceId: readString(assignment?.app_instance_id),
    hasActiveRun: runs.length > 0,
    hasActiveRequest: requests.length > 0,
  };
}

export async function validatePilotAccountForSettings(
  supabase: SupabaseLike,
  accountId: string | null,
): Promise<string | null> {
  if (!accountId) return null;
  const context = await loadPilotValidationContext(supabase, accountId);
  return validatePilotSelection(context);
}
