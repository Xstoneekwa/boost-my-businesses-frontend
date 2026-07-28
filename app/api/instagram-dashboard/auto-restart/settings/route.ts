import { createSupabaseClient } from "@/lib/supabase";
import {
  probeAutoRestartFoundation,
} from "@/lib/instagram-dashboard/auto-restart-foundation";
import {
  defaultAutoRestartRules,
  rulesFromSettingsRow,
} from "@/app/instagram-dashboard/auto-restart-data";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
  type SupabaseRecord,
} from "../../_utils";
import {
  normalizeAutoRestartPatch,
  validateAutoRestartPatch,
  type AutoRestartSettingsPatch,
} from "./helpers";

export const dynamic = "force-dynamic";

async function auditSettingsMutation(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    actorId: string | null;
    patch: ReturnType<typeof normalizeAutoRestartPatch>;
    requestId: string;
  },
) {
  const now = new Date().toISOString();
  await supabase.from("auto_restart_decisions").insert({
    request_id: input.requestId,
    idempotency_key: `settings:${now}:${input.patch.mode}:${input.patch.auto_restart_enabled}`,
    actor: input.actorId ? `admin:${input.actorId}` : "admin",
    action: "auto_restart_settings_updated",
    decision: input.patch.auto_restart_enabled ? input.patch.mode : "disabled",
    reason: "settings_patch",
    mode: input.patch.mode,
    metadata_safe: {
      auto_restart_enabled: input.patch.auto_restart_enabled,
      check_every_minutes: input.patch.check_every_minutes,
    },
  });
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Auto Restart settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const foundation = await probeAutoRestartFoundation(supabase);
    const { data, error } = await supabase
      .from("auto_restart_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle<SupabaseRecord>();

    if (error) {
      return jsonOk({
        rules: defaultAutoRestartRules(),
        backend_pending: true,
        writable: false,
        foundation,
        error: error.message,
      });
    }

    return jsonOk({
      rules: rulesFromSettingsRow(data ?? undefined),
      backend_pending: !foundation.settingsWritable,
      writable: foundation.settingsWritable,
      foundation,
      updated_at: readString(data?.updated_at) || null,
    });
  } catch {
    return jsonError("Could not load Auto Restart settings.", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Auto Restart settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = (await readJsonBody<AutoRestartSettingsPatch>(request)) ?? {};
    const userContext = await getInstagramAdminUserContext();
    const supabase = createSupabaseClient();
    const foundation = await probeAutoRestartFoundation(supabase);
    const { data: existingRow } = await supabase
      .from("auto_restart_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle<SupabaseRecord>();
    const patch = normalizeAutoRestartPatch(body, existingRow);
    const validationError = validateAutoRestartPatch(patch, foundation);
    if (validationError) {
      return jsonError("Auto Restart settings validation failed.", 400, { reason: validationError, foundation });
    }
    if (!foundation.settingsWritable) {
      return jsonError("Auto Restart settings table is not deployed.", 503, {
        reason: "auto_restart_foundation_not_deployed",
        foundation,
      });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("auto_restart_settings")
      .upsert({
        id: "global",
        ...patch,
        updated_at: now,
        updated_by: userContext?.userId ?? null,
      })
      .select("*")
      .single<SupabaseRecord>();

    if (error) {
      return jsonError("Could not save Auto Restart settings.", 500, {
        reason: error.message,
        backend_pending: error.message.toLowerCase().includes("auto_restart_settings"),
      });
    }

    const requestId = `auto-restart-settings-${Date.now().toString(36)}`;
    try {
      await auditSettingsMutation(supabase, {
        actorId: userContext?.userId ?? null,
        patch,
        requestId,
      });
    } catch {
      // Audit is best-effort; settings row is canonical.
    }

    return jsonOk({
      rules: rulesFromSettingsRow(data),
      saved_at: now,
      backend_pending: false,
      writable: true,
      foundation,
      request_id: requestId,
      log_event: "auto_restart_settings_updated",
    });
  } catch {
    return jsonError("Could not save Auto Restart settings.", 500);
  }
}
