import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

const actionContracts = {
  refresh_overview: {
    label: "Refresh overview",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Reloads Auto Restart overview only.",
  },
  dry_run_preview: {
    label: "Run dry-run preview",
    confirmation_required: false,
    backend_status: "preview_only",
    impact: "Recomputes candidates and safety gates without enqueueing work.",
  },
  enable_auto_restart: {
    label: "Enable Auto Restart",
    confirmation_required: true,
    backend_status: "settings_persistence_pending",
    impact: "Would enable scheduler mode after settings persistence and audit storage are implemented.",
  },
  disable_auto_restart: {
    label: "Disable Auto Restart",
    confirmation_required: true,
    backend_status: "settings_persistence_pending",
    impact: "Would disable automatic resume scheduling.",
  },
  restart_eligible_sessions: {
    label: "Restart eligible sessions",
    confirmation_required: true,
    backend_status: "worker_scheduler_pending",
    impact: "Would enqueue only candidates that pass quota, session-window, device-rest, credential, and no-overlap gates.",
  },
  resume_quota_paused: {
    label: "Resume quota-paused accounts",
    confirmation_required: true,
    backend_status: "worker_scheduler_pending",
    impact: "Would resume accounts paused by quota once daily and session caps allow work.",
  },
  pause_device_rest: {
    label: "Pause device rest",
    confirmation_required: true,
    backend_status: "rest_policy_pending",
    impact: "Would temporarily override a rest window under backend policy.",
  },
  resume_phone: {
    label: "Resume phone",
    confirmation_required: true,
    backend_status: "rest_policy_pending",
    impact: "Would resume a phone only after device health and assigned account gates pass.",
  },
  open_affected_accounts: {
    label: "Open affected accounts",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens the affected account projection.",
  },
  open_device: {
    label: "Open device",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens the associated device context.",
  },
  open_compass_issue: {
    label: "Open Compass issue",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens Compass risk context.",
  },
  open_credentials: {
    label: "Open Credentials",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens credential blockers.",
  },
  open_activity_log: {
    label: "Open Activity Log",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Opens activity evidence.",
  },
  view_safety_gates: {
    label: "View safety gates",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Focuses safety gates.",
  },
  view_candidates: {
    label: "View candidates",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Focuses restart candidates.",
  },
  export_preview: {
    label: "Export preview",
    confirmation_required: false,
    backend_status: "export_pending",
    impact: "Would export a safe candidate summary when export storage is wired.",
  },
  copy_safe_summary: {
    label: "Copy safe summary",
    confirmation_required: false,
    backend_status: "read_only",
    impact: "Copies safe status text only.",
  },
} as const;

type AutoRestartAction = keyof typeof actionContracts;

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Auto Restart relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<{ action?: unknown; request_id?: unknown; target?: unknown }>(request);
    const action = readString(body?.action, "") as AutoRestartAction;
    const contract = actionContracts[action];
    if (!contract) {
      return jsonError("Unsupported Auto Restart action.", 400, { reason: "unsupported_auto_restart_action" });
    }

    return jsonOk({
      action,
      ...contract,
      request_id: readString(body?.request_id, `auto-restart-${Date.now().toString(36)}`),
      target: body?.target && typeof body.target === "object" ? body.target : null,
      dry_run: true,
      mutation_executed: false,
      actions_executable: false,
      audit_required_before_activation: true,
    });
  } catch {
    return jsonError("Could not preview Auto Restart action.", 500);
  }
}
