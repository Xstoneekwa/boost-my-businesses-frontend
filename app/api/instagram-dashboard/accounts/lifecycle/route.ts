import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readBoolean, readJsonBody, readString, requireInstagramAdmin, type SupabaseRecord } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type LifecycleAction = "archive" | "trash" | "restore";

type LifecyclePayload = {
  account_id?: unknown;
  action?: unknown;
  reason?: unknown;
  metadata?: unknown;
  start_run?: unknown;
  provisioning_enabled?: unknown;
  login_enabled?: unknown;
};

const lifecycleActions = new Set<LifecycleAction>(["archive", "trash", "restore"]);
const forbiddenMetadataKey = new RegExp(["password", "credential", "secret", "token", "authorization", ["service", "role"].join("_"), "raw_xml", "xml", "serial", "udid", "vault"].join("|"), "i");

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const, userId: null };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    const response = jsonError("Account lifecycle relay authentication failed.", 403, { reason: relayAuth.reason });
    return { mode: "unauthorized" as const, response };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  return { mode: "admin_session" as const, userId: null };
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenMetadataKey.test(key)) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed || forbiddenMetadataKey.test(trimmed)) continue;
      safe[key] = trimmed.slice(0, 240);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      safe[key] = raw;
    } else if (typeof raw === "boolean") {
      safe[key] = raw;
    }
  }
  return safe;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function missingLifecycleColumnError(message: string) {
  return message.toLowerCase().includes("column")
    ? "Missing Instagram account lifecycle columns. Apply lib/instagram-dashboard/ig-accounts-lifecycle.sql migration."
    : message;
}

export async function POST(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const body = await readJsonBody<LifecyclePayload>(request);
    const accountId = readString(body?.account_id, "").trim();
    const action = readString(body?.action, "").trim() as LifecycleAction;
    const reason = readString(body?.reason, "botapp_account_lifecycle").trim().slice(0, 160) || "botapp_account_lifecycle";
    const metadata = safeMetadata(body?.metadata);

    if (!accountId) {
      return jsonError("Missing account_id.", 400);
    }

    if (!lifecycleActions.has(action)) {
      return jsonError("Invalid lifecycle action.", 400);
    }
    if (readBoolean(body?.start_run, false) || readBoolean(body?.provisioning_enabled, false) || readBoolean(body?.login_enabled, false)) {
      return jsonError("automation_flags_must_be_false", 400);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const supabase = createSupabaseClient();
    const { data: currentRow, error: currentError } = await supabase
      .from("ig_accounts")
      .select("id,status,admin_lifecycle_status")
      .eq("id", accountId)
      .maybeSingle<SupabaseRecord>();
    if (currentError) return jsonError(missingLifecycleColumnError(currentError.message), 500);
    if (!currentRow) return jsonError("Instagram account not found.", 404);
    const statusBefore = readString(currentRow.status, readString(currentRow.admin_lifecycle_status, "unknown")).toLowerCase();
    const patch =
      action === "archive"
        ? {
            status: "archived",
            archived_at: nowIso,
            trashed_at: null,
            scheduled_trash_at: addDays(now, 30).toISOString(),
            scheduled_delete_at: null,
            restored_at: null,
          }
        : action === "trash"
          ? {
              status: "trashed",
              archived_at: null,
              trashed_at: nowIso,
              scheduled_trash_at: null,
              scheduled_delete_at: addDays(now, 30).toISOString(),
              restored_at: null,
            }
          : {
              status: "active",
              archived_at: null,
              trashed_at: null,
              scheduled_trash_at: null,
              scheduled_delete_at: null,
              restored_at: nowIso,
            };

    const { data, error } = await supabase
      .from("ig_accounts")
      .update(patch)
      .eq("id", accountId)
      .select("*")
      .maybeSingle();

    if (error) {
      return jsonError(missingLifecycleColumnError(error.message), 500);
    }

    if (!data) {
      return jsonError("Instagram account not found.", 404);
    }

    const statusAfter = readString((data as SupabaseRecord).status, readString((data as SupabaseRecord).admin_lifecycle_status, "unknown")).toLowerCase();
    const { data: auditRow } = await supabase.from("ig_action_logs").insert({
      account_id: accountId,
      run_id: null,
      target_username: null,
      action_type: "account_lifecycle_changed",
      status: "success",
      message: `account_${action}`,
      payload: {
        actor_type: auth.mode === "relay_key" ? "botapp" : "admin",
        actor_id: auth.userId,
        source_surface: auth.mode === "relay_key" ? "botapp_profiles_actions" : "instagram_dashboard",
        action,
        reason,
        status_before: statusBefore,
        status_after: statusAfter,
        metadata,
        run_started: false,
        provisioning_started: false,
        login_started: false,
      },
      created_at: nowIso,
    }).select("id").maybeSingle<SupabaseRecord>();

    return jsonOk({
      account_id: accountId,
      action,
      status_before: statusBefore,
      status_after: statusAfter,
      row: data,
      audit_event_id: readString(auditRow?.id, "") || null,
      run_started: false,
      provisioning_started: false,
      login_started: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Instagram account lifecycle.";
    return jsonError(message, 500);
  }
}
