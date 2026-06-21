import type { SupabaseClient } from "@supabase/supabase-js";
import { logCheckoutActivation } from "./checkout-activation-log.ts";

export type ActivationAttemptTracker = {
  idempotencyKey: string;
  authCreatedThisAttempt: boolean;
  authUserId: string | null;
  clientCreatedThisAttempt: boolean;
  clientId: string | null;
  tenantLinkedThisAttempt: boolean;
  resumedIncompleteCheckout: boolean;
};

export async function compensateFailedActivationAttempt(
  supabase: SupabaseClient,
  tracker: ActivationAttemptTracker,
  input: { stage: string; reason: string; postgresCode?: string },
) {
  logCheckoutActivation({
    event: "checkout_activation_compensation_attempted",
    idempotencyKey: tracker.idempotencyKey,
    authUserId: tracker.authUserId,
    clientId: tracker.clientId,
    stage: input.stage,
    reason: input.reason,
    postgresCode: input.postgresCode,
  });

  const results: string[] = [];

  const preservePartialPublicCheckout =
    tracker.resumedIncompleteCheckout
    || tracker.tenantLinkedThisAttempt
    || (tracker.clientCreatedThisAttempt && tracker.clientId);

  if (preservePartialPublicCheckout) {
    results.push("compensation_skipped_resume_state");
    logCheckoutActivation({
      event: "checkout_activation_compensation_completed",
      idempotencyKey: tracker.idempotencyKey,
      authUserId: tracker.authUserId,
      clientId: tracker.clientId,
      stage: input.stage,
      reason: `${input.reason}:${results.join(",")}`,
    });
    return;
  }

  if (tracker.clientCreatedThisAttempt && tracker.clientId) {
    const { count: tenantCount } = await supabase
      .from("tenant_users")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", tracker.clientId);
    const { count: entitlementCount } = await supabase
      .from("client_account_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("client_id", tracker.clientId);
    const { count: igCount } = await supabase
      .from("client_instagram_accounts")
      .select("id", { count: "exact", head: true })
      .eq("client_id", tracker.clientId);

    if ((tenantCount ?? 0) === 0 && (entitlementCount ?? 0) === 0 && (igCount ?? 0) === 0) {
      const { error } = await supabase.from("clients").delete().eq("id", tracker.clientId);
      results.push(error ? "client_delete_failed" : "client_deleted");
    } else {
      results.push("client_delete_skipped_has_dependencies");
    }
  }

  if (tracker.authCreatedThisAttempt && tracker.authUserId) {
    const { count: tenantCount } = await supabase
      .from("tenant_users")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", tracker.authUserId);
    if ((tenantCount ?? 0) === 0) {
      const { error } = await supabase.auth.admin.deleteUser(tracker.authUserId);
      results.push(error ? "auth_delete_failed" : "auth_deleted");
    } else {
      results.push("auth_delete_skipped_has_tenant");
    }
  }

  logCheckoutActivation({
    event: "checkout_activation_compensation_completed",
    idempotencyKey: tracker.idempotencyKey,
    authUserId: tracker.authUserId,
    clientId: tracker.clientId,
    stage: input.stage,
    reason: `${input.reason}:${results.join(",") || "noop"}`,
  });
}
