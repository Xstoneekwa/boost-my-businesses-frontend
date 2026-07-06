/**
 * CP0 — Canonical authorization contract for automatic run creation.
 *
 * `auto_restart_settings.auto_restart_enabled` is the single business switch
 * governing every automatic `account_run_request` source:
 *   - `instagram_schedule_session_cron` (daily cold-start sessions)
 *   - `auto_restart_tick` (resume-plan restarts)
 *
 * Manual Play/Stop, Auto Login, login provisioning and code-resume surfaces
 * are intentionally NOT governed by this contract.
 *
 * This application-level read is observability/fast-path only: the atomic
 * enforcement lives inside the `create_account_run_request` RPC, which locks
 * the settings row (FOR SHARE) before persisting any automatic request, so a
 * concurrent toggle OFF can never race an automatic insert.
 */

export const SCHEDULER_DISABLED_REASON = "scheduler_disabled";

export const AUTOMATIC_RUN_SOURCE_SURFACES = [
  "auto_restart_tick",
  "instagram_schedule_session_cron",
] as const;

export type SchedulerAutomaticRunAuthorization = {
  enabled: boolean;
  allowed: boolean;
  reason: typeof SCHEDULER_DISABLED_REASON | null;
  settingsAvailable: boolean;
};

/** Pure decision: automatic run creation is allowed only when the toggle is ON. */
export function automaticRunCreationAllowed(
  input: { enabled: boolean | null | undefined },
): { allowed: boolean; reason: typeof SCHEDULER_DISABLED_REASON | null } {
  if (input.enabled === true) {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: SCHEDULER_DISABLED_REASON };
}

type SupabaseLike = {
  from: (table: string) => unknown;
};

type SettingsQuery = {
  select: (...args: unknown[]) => SettingsQuery;
  eq: (...args: unknown[]) => SettingsQuery;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

/**
 * Reads the canonical toggle. Fails closed: a missing row or a read error is
 * treated as Scheduler OFF (no automatic request may be created).
 */
export async function loadSchedulerAutomaticRunAuthorization(
  supabase: SupabaseLike,
): Promise<SchedulerAutomaticRunAuthorization> {
  try {
    const result = await (supabase.from("auto_restart_settings") as SettingsQuery)
      .select("auto_restart_enabled")
      .eq("id", "global")
      .maybeSingle();
    if (result.error) {
      return { enabled: false, allowed: false, reason: SCHEDULER_DISABLED_REASON, settingsAvailable: false };
    }
    const row = (result.data ?? null) as { auto_restart_enabled?: unknown } | null;
    if (!row) {
      return { enabled: false, allowed: false, reason: SCHEDULER_DISABLED_REASON, settingsAvailable: false };
    }
    const enabled = row.auto_restart_enabled === true;
    const decision = automaticRunCreationAllowed({ enabled });
    return { enabled, allowed: decision.allowed, reason: decision.reason, settingsAvailable: true };
  } catch {
    return { enabled: false, allowed: false, reason: SCHEDULER_DISABLED_REASON, settingsAvailable: false };
  }
}

/** Matches the atomic rejection raised by the create_account_run_request RPC. */
export function isSchedulerDisabledEnqueueError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes(SCHEDULER_DISABLED_REASON);
}
