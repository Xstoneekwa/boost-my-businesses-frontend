import { createSupabaseClient } from "@/lib/supabase";
import { getInstagramAdminUserContext, jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

type PasswordUpdateRequestPayload = {
  account_id?: unknown;
  reason?: unknown;
  metadata?: unknown;
};

type SupabaseRecord = Record<string, unknown>;

const activeRequestStatuses = ["pending", "acknowledged", "pending_verification"] as const;
const forbiddenMetadataTerms = [
  "password",
  "credential",
  "secret",
  "token",
  "authorization",
  ["service", "role"].join("_"),
  ["raw", "xml"].join("_"),
  "xml",
  "serial",
  "udid",
  "vault",
];

function safeMetadata(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (forbiddenMetadataTerms.some((term) => normalizedKey.includes(term))) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      const normalizedValue = trimmed.toLowerCase();
      if (!trimmed || forbiddenMetadataTerms.some((term) => normalizedValue.includes(term))) continue;
      safe[key] = trimmed.slice(0, 240);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      safe[key] = raw;
    } else if (typeof raw === "boolean") {
      safe[key] = raw;
    }
  }
  return safe;
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const payload = (await readJsonBody<PasswordUpdateRequestPayload>(request)) ?? {};
    const accountId = readString(payload.account_id).trim();
    const reason = readString(payload.reason, "password_update_required").trim() || "password_update_required";

    if (!accountId) return jsonError("Missing account_id.", 400);

    const supabase = createSupabaseClient();
    const { data: accountRow, error: accountError } = await supabase
      .from("ig_accounts")
      .select("id,username,status,admin_lifecycle_status")
      .eq("id", accountId)
      .limit(1)
      .maybeSingle<SupabaseRecord>();

    if (accountError) return jsonError(accountError.message, 500);
    if (!accountRow) return jsonError("Instagram account not found.", 404);

    const status = readString(accountRow.status).toLowerCase();
    const lifecycle = readString(accountRow.admin_lifecycle_status, status).toLowerCase();
    if (["archived", "trashed", "cancelled", "canceled", "deleted"].includes(status)
      || ["archived", "trashed", "cancelled", "canceled", "deleted"].includes(lifecycle)) {
      return jsonError("Cannot request a password update for an inactive account.", 409);
    }

    const { data: linkRows, error: linkError } = await supabase
      .from("client_instagram_accounts")
      .select("client_id")
      .eq("account_id", accountId)
      .limit(1);

    if (linkError) return jsonError(linkError.message, 500);
    const clientId = readString(((linkRows ?? []) as SupabaseRecord[])[0]?.client_id);
    if (!clientId) return jsonError("Client account link is missing.", 409);

    const { data: existingActions, error: existingError } = await supabase
      .from("account_dashboard_actions")
      .select("id,status")
      .eq("account_id", accountId)
      .eq("action_type", "update_instagram_password")
      .in("status", [...activeRequestStatuses])
      .limit(1);

    if (existingError) return jsonError(existingError.message, 500);

    const existing = ((existingActions ?? []) as SupabaseRecord[])[0];
    if (existing) {
      return jsonOk({
        account_id: accountId,
        action_id: readString(existing.id),
        status: readString(existing.status, "pending"),
        notification_status: "already_requested",
        email_delivery_status: "pending_backend",
      }, 200);
    }

    const username = readString(accountRow.username, "Instagram account");
    const actorContext = await getInstagramAdminUserContext();
    const now = new Date().toISOString();
    const metadata = {
      source_surface: "client_accounts",
      source: "admin_dashboard",
      reason,
      notification_type: "password_update_required",
      email_template: "instagram_password_update_required",
      email_delivery_status: "pending_backend",
      requested_at: now,
      ...safeMetadata(payload.metadata),
    };

    const { data: createdAction, error: upsertError } = await supabase.rpc("upsert_account_dashboard_action", {
      p_account_id: accountId,
      p_client_id: clientId,
      p_incident_id: null,
      p_action_type: "update_instagram_password",
      p_status: "pending",
      p_title: "Password update required",
      p_dedupe_key: `account:${accountId}:dashboard_action:update_instagram_password`,
      p_safe_client_message: `Password update required for @${username}. Please update your Instagram password so we can reconnect your account safely.`,
      p_admin_message: "Client password update request sent from Client Accounts.",
      p_assistant_message: null,
      p_action_label: "Update password",
      p_action_deep_link: "/instagram-client?view=account",
      p_severity: "warning",
      p_audience: "client",
      p_requires_client_action: true,
      p_blocking_campaign: true,
      p_metadata: metadata,
    });

    if (upsertError) return jsonError(upsertError.message, 500);

    try {
      await supabase.from("ig_action_logs").insert({
        account_id: accountId,
        run_id: null,
        target_username: null,
        action_type: "client_account_password_update_requested",
        status: "success",
        message: "password_update_requested",
        payload: {
          actor_type: "admin",
          actor_id: actorContext?.userId ?? null,
          source_surface: "client_accounts",
          action_type: "update_instagram_password",
          notification_type: "password_update_required",
          email_template: "instagram_password_update_required",
          email_delivery_status: "pending_backend",
        },
        created_at: now,
      });
    } catch {
      // The dashboard action is authoritative; audit can be reconciled later.
    }

    return jsonOk({
      account_id: accountId,
      action_id: readString((createdAction as SupabaseRecord | null | undefined)?.id),
      status: "pending",
      notification_status: "created",
      email_delivery_status: "pending_backend",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not request password update.";
    return jsonError(message, 500);
  }
}
