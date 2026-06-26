import { createSupabaseClient } from "@/lib/supabase";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  type SupabaseRecord,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";
import { reconcileClientAccountNotificationsForAccount } from "@/lib/instagram-client/client-account-notifications";

export const dynamic = "force-dynamic";

type AccountStatusAction = "pause" | "cancel" | "mark_needs_assistance" | "reactivate";

type AccountStatusPayload = {
  account_id?: unknown;
  action?: unknown;
  reason?: unknown;
  metadata?: unknown;
  start_run?: unknown;
  provisioning_enabled?: unknown;
  login_enabled?: unknown;
};

const statusActions = new Set<AccountStatusAction>(["pause", "cancel", "mark_needs_assistance", "reactivate"]);
const activeRequestStatuses = ["queued", "claimed", "starting", "running"];
const activeRunStatuses = ["queued", "pending", "starting", "running", "in_progress", "active"];
const forbiddenMetadataKey = new RegExp(["password", "credential", "secret", "token", "authorization", ["service", "role"].join("_"), "raw_xml", "xml", "serial", "udid"].join("|"), "i");

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const, userId: null };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    const response = jsonError("Account status relay authentication failed.", 403, { reason: relayAuth.reason });
    return { mode: "unauthorized" as const, response };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  const adminContext = await getInstagramAdminUserContext();
  return { mode: "admin_session" as const, userId: adminContext?.userId ?? null };
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenMetadataKey.test(key)) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed || forbiddenMetadataKey.test(trimmed)) continue;
      safe[key] = trimmed.slice(0, 300);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      safe[key] = raw;
    } else if (typeof raw === "boolean") {
      safe[key] = raw;
    }
  }
  return safe;
}

function statusForAction(action: AccountStatusAction) {
  if (action === "pause") return "paused";
  if (action === "cancel") return "cancelled";
  if (action === "mark_needs_assistance") return "needs_assistance";
  return "active";
}

function eventForAction(action: AccountStatusAction) {
  if (action === "pause") return "account_paused";
  if (action === "cancel") return "account_cancelled";
  if (action === "mark_needs_assistance") return "account_marked_needs_assistance";
  return "account_reactivated";
}

async function hasActiveRuntime(supabase: ReturnType<typeof createSupabaseClient>, accountId: string) {
  const [{ data: requests }, { data: runs }] = await Promise.all([
    supabase
      .from("account_run_requests")
      .select("id,status")
      .eq("account_id", accountId)
      .in("status", activeRequestStatuses)
      .limit(1),
    supabase
      .from("ig_runs")
      .select("id,status")
      .eq("account_id", accountId)
      .in("status", activeRunStatuses)
      .limit(1),
  ]);

  return Boolean((requests ?? []).length || (runs ?? []).length);
}

async function reactivateBlockReason(supabase: ReturnType<typeof createSupabaseClient>, accountId: string, lifecycleStatus: string) {
  if (["archived", "trashed", "trash", "deleted"].includes(lifecycleStatus)) {
    return "Restore the archived account lifecycle before reactivation.";
  }

  const [{ data: credentials }, { data: actions }] = await Promise.all([
    supabase
      .from("account_credentials")
      .select("status,reauth_required,secret_ref")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("account_dashboard_actions")
      .select("id,action_type,blocking_campaign,status")
      .eq("account_id", accountId)
      .in("status", ["pending", "acknowledged", "pending_verification"])
      .limit(10),
  ]);

  const credential = ((credentials ?? []) as SupabaseRecord[])[0];
  const credentialStatus = readString(credential?.status, "").toLowerCase();
  const hasSecretRef = Boolean(readString(credential?.secret_ref, ""));
  if (readBoolean(credential?.reauth_required, false)) return "Resolve credential reauth before reactivation.";
  if (!credential || credentialStatus !== "active" || !hasSecretRef) return "Active configured credentials are required before reactivation.";

  const blockingActions = ((actions ?? []) as SupabaseRecord[]).filter((action) => readBoolean(action.blocking_campaign, false));
  if (blockingActions.length > 0) return "Resolve blocking dashboard actions before reactivation.";
  return null;
}

async function auditStatusChange(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    actorId: string | null;
    actorType: "admin" | "botapp";
    action: AccountStatusAction;
    oldStatus: string;
    newStatus: string;
    reason: string | null;
    metadata: Record<string, unknown>;
  },
) {
  const { data } = await supabase.from("ig_action_logs").insert({
    account_id: input.accountId,
    run_id: null,
    target_username: null,
    action_type: "account_admin_status_changed",
    status: "success",
    message: eventForAction(input.action),
    payload: {
      actor_type: input.actorType,
      actor_id: input.actorId,
      source_surface: input.actorType === "botapp" ? "botapp_profiles_actions" : "client_accounts_actions",
      action: input.action,
      old_admin_lifecycle_status: input.oldStatus,
      new_admin_lifecycle_status: input.newStatus,
      reason: input.reason,
      metadata: input.metadata,
      run_started: false,
      provisioning_started: false,
      login_started: false,
    },
    created_at: new Date().toISOString(),
  }).select("id").maybeSingle<SupabaseRecord>();
  return readString(data?.id, "") || null;
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const body = await readJsonBody<AccountStatusPayload>(request);
    if (!body) return jsonError("Invalid account status payload.", 400);

    const accountId = readString(body.account_id, "").trim();
    const action = readString(body.action, "").trim() as AccountStatusAction;
    const reason = readString(body.reason, "").trim().slice(0, 500) || null;
    const metadata = safeMetadata(body.metadata);

    if (!accountId) return jsonError("Missing account_id.", 400);
    if (!statusActions.has(action)) return jsonError("Invalid account status action.", 400);
    if (readBoolean(body.start_run, false) || readBoolean(body.provisioning_enabled, false) || readBoolean(body.login_enabled, false)) {
      return jsonError("automation_flags_must_be_false", 400);
    }

    const supabase = createSupabaseClient();
    const { data: currentRow, error: currentError } = await supabase
      .from("ig_accounts")
      .select("id,status,admin_lifecycle_status")
      .eq("id", accountId)
      .limit(1)
      .maybeSingle<SupabaseRecord>();

    if (currentError) return jsonError(currentError.message, 500);
    if (!currentRow) return jsonError("Instagram account not found.", 404);

    if (action === "cancel" && await hasActiveRuntime(supabase, accountId)) {
      return jsonError("Cannot cancel while a run or run request is active. Stop the runtime first.", 409);
    }

    const oldStatus = readString(currentRow.admin_lifecycle_status, readString(currentRow.status, "active")).toLowerCase();
    const accountLifecycleStatus = readString(currentRow.status, "active").toLowerCase();
    if (action === "reactivate") {
      const blockReason = await reactivateBlockReason(supabase, accountId, accountLifecycleStatus);
      if (blockReason) return jsonError(blockReason, 409);
    }
    const newStatus = statusForAction(action);

    const { data: updatedRow, error: updateError } = await supabase
      .from("ig_accounts")
      .update({ admin_lifecycle_status: newStatus })
      .eq("id", accountId)
      .select("id,status,admin_lifecycle_status")
      .maybeSingle<SupabaseRecord>();

    if (updateError) return jsonError(updateError.message, 500);
    if (!updatedRow) return jsonError("Instagram account not found.", 404);

    let capacityReleaseStatus: "not_applicable" | "released" | "pending_schema" = "not_applicable";
    if (action === "cancel") {
      const { error: releaseError } = await supabase.rpc("release_account_schedule_capacity", {
        p_account_id: accountId,
        p_reason: "account_cancelled_release",
        p_source: "accounts_status_api",
        p_actor_id: auth.userId,
      });
      capacityReleaseStatus = releaseError ? "pending_schema" : "released";
    }

    const auditEventId = await auditStatusChange(supabase, {
      accountId,
      actorId: auth.userId,
      actorType: auth.mode === "relay_key" ? "botapp" : "admin",
      action,
      oldStatus,
      newStatus,
      reason,
      metadata,
    }).catch(() => undefined);

    await reconcileClientAccountNotificationsForAccount(supabase, accountId);

    return jsonOk({
      account_id: accountId,
      action,
      status_before: oldStatus,
      status_after: newStatus,
      old_admin_lifecycle_status: oldStatus,
      new_admin_lifecycle_status: newStatus,
      capacity_release_status: capacityReleaseStatus,
      audit_event: eventForAction(action),
      audit_event_id: auditEventId ?? null,
      run_started: false,
      provisioning_started: false,
      login_started: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update account status.";
    return jsonError(message, 500);
  }
}
