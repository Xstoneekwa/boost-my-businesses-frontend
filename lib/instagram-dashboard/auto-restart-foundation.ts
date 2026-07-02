import type { SupabaseClient } from "@supabase/supabase-js";

export const AUTO_RESTART_FOUNDATION_TABLES = [
  "auto_restart_settings",
  "auto_restart_decisions",
  "auto_restart_tick_locks",
  "auto_restart_device_locks",
  "phone_rest_overrides",
] as const;

export type AutoRestartFoundationStatus = {
  ready: boolean;
  missing: string[];
  settingsWritable: boolean;
};

export async function probeAutoRestartFoundation(
  supabase: Pick<SupabaseClient, "from">,
): Promise<AutoRestartFoundationStatus> {
  const missing: string[] = [];
  for (const table of AUTO_RESTART_FOUNDATION_TABLES) {
    const { error } = await supabase.from(table).select("*").limit(0);
    if (error) {
      missing.push(table);
    }
  }
  return {
    ready: missing.length === 0,
    missing,
    settingsWritable: !missing.includes("auto_restart_settings"),
  };
}

export function autoRestartFoundationBlockReason(status: AutoRestartFoundationStatus) {
  if (status.ready) return null;
  return "auto_restart_foundation_not_deployed";
}

export function validateActiveModePrerequisites(input: {
  patch: { mode: string; auto_restart_enabled: boolean };
  foundation: AutoRestartFoundationStatus;
  tickTokenConfigured: boolean;
}) {
  const wantsActive = input.patch.auto_restart_enabled && input.patch.mode === "active";
  if (!wantsActive) return null;

  const foundationReason = autoRestartFoundationBlockReason(input.foundation);
  if (foundationReason) return foundationReason;

  if (!input.tickTokenConfigured) {
    return "active_mode_tick_token_not_configured";
  }

  return null;
}
