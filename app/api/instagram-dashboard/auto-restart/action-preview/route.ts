import { createSupabaseClient } from "@/lib/supabase";
import { probeAutoRestartFoundation } from "@/lib/instagram-dashboard/auto-restart-foundation";
import { jsonError, jsonOk, readJsonBody, readString, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

const mutationActions = new Set([
  "enable_auto_restart",
  "disable_auto_restart",
  "restart_eligible_sessions",
  "resume_quota_paused",
  "pause_device_rest",
  "resume_phone",
]);

const actionContracts = {
  refresh_overview: {
    label: "Refresh overview",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Reloads Auto Restart overview only.",
    executable: true,
  },
  dry_run_preview: {
    label: "Run dry-run preview",
    confirmation_required: false,
    backend_status: "dry_run",
    impact: "Recomputes candidates and safety gates without enqueueing work.",
    executable: true,
  },
  enable_auto_restart: {
    label: "Enable Auto Restart",
    confirmation_required: true,
    backend_status: "active",
    impact: "Enables scheduler mode after confirmation; persists settings.",
    executable: true,
  },
  disable_auto_restart: {
    label: "Disable Auto Restart",
    confirmation_required: true,
    backend_status: "active",
    impact: "Disables automatic resume scheduling; existing runs continue.",
    executable: true,
  },
  restart_eligible_sessions: {
    label: "Restart eligible sessions",
    confirmation_required: true,
    backend_status: "active",
    impact: "Runs a manual scheduler tick with full guard revalidation.",
    executable: true,
  },
  resume_quota_paused: {
    label: "Resume quota-paused accounts",
    confirmation_required: true,
    backend_status: "active",
    impact: "Manual tick for quota-paused accounts with runtime resume support only.",
    executable: true,
  },
  pause_device_rest: {
    label: "Pause device rest",
    confirmation_required: true,
    backend_status: "active",
    impact: "Overrides rest window for the selected phone.",
    executable: true,
  },
  resume_phone: {
    label: "Resume phone",
    confirmation_required: true,
    backend_status: "active",
    impact: "Ends phone rest override after confirmation.",
    executable: true,
  },
  open_affected_accounts: {
    label: "Open affected accounts",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens the affected account projection.",
    executable: false,
  },
  open_device: {
    label: "Open device",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens the associated device context.",
    executable: false,
  },
  open_compass_issue: {
    label: "Open Compass issue",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens Compass risk context.",
    executable: false,
  },
  open_credentials: {
    label: "Open Credentials",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens credential blockers.",
    executable: false,
  },
  open_activity_log: {
    label: "Open Activity Log",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens activity evidence.",
    executable: false,
  },
  view_safety_gates: {
    label: "View safety gates",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Focuses safety gates.",
    executable: false,
  },
  view_candidates: {
    label: "View candidates",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Focuses restart candidates.",
    executable: false,
  },
  export_preview: {
    label: "Export preview",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Copies safe overview summary.",
    executable: false,
  },
  copy_safe_summary: {
    label: "Copy safe summary",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Copies safe status text only.",
    executable: false,
  },
} as const;

type AutoRestartAction = keyof typeof actionContracts;

async function requireRelayOrAdminLocal(request: Request) {
  const { verifyCompassRelayKey } = await import("../../compass/relay-auth");
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Auto Restart relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  const { requireInstagramAdmin } = await import("../../_utils");
  return requireInstagramAdmin();
}

function gateMutationExecutable(
  action: AutoRestartAction,
  foundation: Awaited<ReturnType<typeof probeAutoRestartFoundation>>,
) {
  if (!mutationActions.has(action)) return true;
  if (!foundation.ready) return false;
  if (action === "enable_auto_restart") {
    return Boolean(process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN);
  }
  return true;
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdminLocal(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<{ action?: unknown; request_id?: unknown; target?: unknown }>(request);
    const action = readString(body?.action, "") as AutoRestartAction;
    const contract = actionContracts[action];
    if (!contract) {
      return jsonError("Unsupported Auto Restart action.", 400, { reason: "unsupported_auto_restart_action" });
    }

    const foundation = await probeAutoRestartFoundation(createSupabaseClient());
    const executable = contract.executable && gateMutationExecutable(action, foundation);
    const blockReason = !executable && mutationActions.has(action)
      ? (!foundation.ready
        ? "auto_restart_foundation_not_deployed"
        : action === "enable_auto_restart" && !process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN
          ? "active_mode_tick_token_not_configured"
          : "auto_restart_action_blocked")
      : null;

    return jsonOk({
      action,
      ...contract,
      executable,
      block_reason: blockReason,
      foundation,
      request_id: readString(body?.request_id, `auto-restart-${Date.now().toString(36)}`),
      target: body?.target && typeof body.target === "object" ? body.target : null,
      dry_run: !executable,
      mutation_executed: false,
      actions_executable: executable,
      execute_route: executable ? "/api/instagram-dashboard/auto-restart/execute" : null,
      audit_required_before_activation: contract.confirmation_required,
    });
  } catch {
    return jsonError("Could not preview Auto Restart action.", 500);
  }
}
