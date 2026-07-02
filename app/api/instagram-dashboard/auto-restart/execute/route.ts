import { createSupabaseClient } from "@/lib/supabase";
import { runAutoRestartTick } from "@/lib/instagram-dashboard/auto-restart-tick";
import { cancelPendingAutoRestartRequests } from "@/lib/instagram-dashboard/auto-restart-lifecycle";
import {
  probeAutoRestartFoundation,
  validateActiveModePrerequisites,
} from "@/lib/instagram-dashboard/auto-restart-foundation";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
  type SupabaseRecord,
} from "../../_utils";
import {
  validatePilotAccountForSettings,
} from "@/lib/instagram-dashboard/auto-restart-pilot";
import {
  normalizeAutoRestartPatch,
  patchToRulePreview,
} from "../settings/route";

export const dynamic = "force-dynamic";

const mutationActions = new Set([
  "enable_auto_restart",
  "disable_auto_restart",
  "restart_eligible_sessions",
  "resume_quota_paused",
  "pause_device_rest",
  "resume_phone",
]);

type ExecuteBody = {
  action?: unknown;
  request_id?: unknown;
  target?: unknown;
  confirmed?: unknown;
};

function readTarget(body: ExecuteBody) {
  if (!body.target || typeof body.target !== "object" || Array.isArray(body.target)) return {};
  return body.target as Record<string, unknown>;
}

async function persistSettingsPatch(patch: ReturnType<typeof normalizeAutoRestartPatch>, actorId: string | null) {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("auto_restart_settings")
    .upsert({
      id: "global",
      ...patch,
      updated_at: now,
      updated_by: actorId,
    })
    .select("*")
    .single<SupabaseRecord>();
  if (error) throw new Error(error.message || "settings_save_failed");
  return { rules: rulesFromSettingsRow(data), saved_at: now };
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Auto Restart execute");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<ExecuteBody>(request);
    const action = readString(body?.action, "");
    const requestId = readString(body?.request_id, `auto-restart-exec-${Date.now().toString(36)}`);
    const confirmed = readBoolean(body?.confirmed, false);
    const target = readTarget(body ?? {});

    if (!mutationActions.has(action)) {
      return jsonError("Unsupported Auto Restart mutation.", 400, { reason: "unsupported_auto_restart_action" });
    }
    if (!confirmed) {
      return jsonError("Confirmation required.", 400, { reason: "confirmation_required" });
    }

    const userContext = await getInstagramAdminUserContext();
    const actor = userContext?.userId ? `botapp/operator:${userContext.userId}` : "botapp/operator";
    const supabase = createSupabaseClient();
    const foundation = await probeAutoRestartFoundation(supabase);

    if (action === "enable_auto_restart") {
      const { data: existingRow } = await supabase
        .from("auto_restart_settings")
        .select("*")
        .eq("id", "global")
        .maybeSingle<SupabaseRecord>();
      const mergedPatch = normalizeAutoRestartPatch(
        { auto_restart_enabled: true, mode: "active" },
        existingRow,
      );
      const pilotReason = mergedPatch.pilot_account_id
        ? await validatePilotAccountForSettings(supabase, mergedPatch.pilot_account_id)
        : "pilot_allowlist_missing";
      if (pilotReason) {
        return jsonError("Auto Restart activation refused.", 400, { reason: pilotReason, foundation });
      }
      const validationError = validateActiveModePrerequisites({
        patch: mergedPatch,
        foundation,
        tickTokenConfigured: Boolean(process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN),
      });
      if (validationError) {
        return jsonError("Auto Restart activation refused.", 400, { reason: validationError, foundation });
      }
      const saved = await persistSettingsPatch(mergedPatch, userContext?.userId ?? null);
      return jsonOk({
        action,
        request_id: requestId,
        mutation_executed: true,
        log_event: "auto_restart_settings_updated",
        ...saved,
      });
    }

    if (action === "disable_auto_restart") {
      const canceled = await cancelPendingAutoRestartRequests(supabase as never, {
        actor,
        requestId,
      });
      const saved = await persistSettingsPatch(
        normalizeAutoRestartPatch({
          auto_restart_enabled: false,
          mode: "disabled",
        }),
        userContext?.userId ?? null,
      );
      return jsonOk({
        action,
        request_id: requestId,
        mutation_executed: true,
        log_event: "auto_restart_settings_updated",
        canceled_pending_requests: canceled.canceled_count,
        ...saved,
      });
    }

    if (action === "restart_eligible_sessions" || action === "resume_quota_paused") {
      if (!foundation.ready) {
        return jsonError("Auto Restart foundation not deployed.", 503, {
          reason: "auto_restart_foundation_not_deployed",
          foundation,
        });
      }
      const tick = await runAutoRestartTick(supabase as never, {
        workerId: "",
        requestedByActor: "botapp-manual-restart",
        internal: true,
        manual: true,
        dryRun: false,
        actor,
      });
      if (tick.status !== 200) {
        return jsonError(tick.result.reason ?? "Auto Restart manual tick failed.", tick.status);
      }
      return jsonOk({
        action,
        request_id: requestId,
        mutation_executed: true,
        log_event: action === "resume_quota_paused"
          ? "auto_restart_quota_resume_requested"
          : "auto_restart_manual_restart_requested",
        tick: tick.result,
      });
    }

    if (action === "pause_device_rest" || action === "resume_phone") {
      if (!foundation.ready) {
        return jsonError("Auto Restart foundation not deployed.", 503, {
          reason: "auto_restart_foundation_not_deployed",
          foundation,
        });
      }
      const deviceId = readString(target.device_id, "");
      if (!deviceId) {
        return jsonError("device_id required.", 400, { reason: "device_id_required" });
      }
      const now = new Date().toISOString();
      if (action === "pause_device_rest") {
        const { error } = await supabase.from("phone_rest_overrides").upsert({
          device_id: deviceId,
          status: "paused",
          reason: "operator_pause",
          updated_at: now,
          metadata_safe: { request_id: requestId, actor },
        });
        if (error) {
          return jsonError("Could not pause device rest.", 500, { reason: error.message });
        }
        await supabase.from("auto_restart_decisions").insert({
          request_id: requestId,
          idempotency_key: `phone-rest-pause:${deviceId}:${now}`,
          actor,
          device_id: deviceId,
          action: "auto_restart_phone_rest_paused",
          decision: "paused",
          reason: "operator_pause",
          mode: "active",
          metadata_safe: { device_id: deviceId },
        });
        return jsonOk({
          action,
          request_id: requestId,
          mutation_executed: true,
          log_event: "auto_restart_phone_rest_paused",
          device_id: deviceId,
        });
      }

      const { error } = await supabase.from("phone_rest_overrides").upsert({
        device_id: deviceId,
        status: "resumed",
        reason: "operator_resume",
        updated_at: now,
        metadata_safe: { request_id: requestId, actor },
      });
      if (error) {
        return jsonError("Could not resume phone rest.", 500, { reason: error.message });
      }
      await supabase.from("auto_restart_decisions").insert({
        request_id: requestId,
        idempotency_key: `phone-rest-resume:${deviceId}:${now}`,
        actor,
        device_id: deviceId,
        action: "auto_restart_phone_rest_resumed",
        decision: "resumed",
        reason: "operator_resume",
        mode: "active",
        metadata_safe: { device_id: deviceId },
      });
      return jsonOk({
        action,
        request_id: requestId,
        mutation_executed: true,
        log_event: "auto_restart_phone_rest_resumed",
        device_id: deviceId,
      });
    }

    return jsonError("Unsupported Auto Restart mutation.", 400, { reason: "unsupported_auto_restart_action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not execute Auto Restart action.";
    return jsonError(message, 500);
  }
}
