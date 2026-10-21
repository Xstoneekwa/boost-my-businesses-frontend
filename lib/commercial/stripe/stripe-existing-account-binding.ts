import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntitlementById, markEntitlementConsumed } from "../entitlements.ts";
import type { PlanKey } from "../catalog.ts";
import type { CommercialMigrationKind, CommercialTestMode } from "./commercial-test-mode.ts";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

const INELIGIBLE_ACCOUNT_STATUSES = new Set([
  "archived",
  "trashed",
  "deleted",
  "cancelled",
  "canceled",
]);

export async function assertExistingAccountStripeCheckoutTarget(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    accountId: string;
    planKey: PlanKey;
    commercialTestMode: CommercialTestMode;
    commercialMigrationKind?: CommercialMigrationKind | null;
    commercialMigrationAuthorizationId?: string | null;
  },
) {
  const clientId = readString(input.clientId);
  const accountId = readString(input.accountId);
  if (!clientId || !accountId) {
    return { ok: false as const, code: "target_account_required" as const };
  }

  const { data: link, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,client_id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<Row>();
  if (linkError || !link?.account_id) {
    return { ok: false as const, code: "target_account_client_mismatch" as const };
  }

  const { data: account, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle<Row>();
  if (accountError || !account?.id) {
    return { ok: false as const, code: "target_account_not_found" as const };
  }
  const accountStatus = readString(account.status).toLowerCase();
  const lifecycleStatus = readString(account.admin_lifecycle_status).toLowerCase();
  if (INELIGIBLE_ACCOUNT_STATUSES.has(accountStatus) || INELIGIBLE_ACCOUNT_STATUSES.has(lifecycleStatus)) {
    return { ok: false as const, code: "target_account_ineligible" as const };
  }

  const { data: packageSummary, error: packageError } = await supabase
    .from("account_package_summary")
    .select("commercial_package_code")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<Row>();
  if (packageError || readString(packageSummary?.commercial_package_code).toLowerCase() !== input.planKey) {
    return { ok: false as const, code: "target_account_package_mismatch" as const };
  }

  const { data: entitlementRows, error: entitlementError } = await supabase
    .from("client_account_entitlements")
    .select("id,status,plan_key,commercial_package_code,metadata")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .eq("status", "entitlement_consumed")
    .limit(2);
  if (entitlementError) {
    return { ok: false as const, code: "target_entitlement_lookup_failed" as const };
  }
  const consumedEntitlements = Array.isArray(entitlementRows) ? entitlementRows as Row[] : [];
  const migrationKind = input.commercialMigrationKind ?? null;
  if (!migrationKind && consumedEntitlements.length > 0) {
    return { ok: false as const, code: "target_modern_entitlement_exists" as const };
  }

  let sourceEntitlementId: string | null = null;
  let migrationAuthorizationId: string | null = null;
  if (migrationKind === "simulated_to_stripe_test") {
    if (input.commercialTestMode !== "stripe_test") {
      return { ok: false as const, code: "migration_requires_stripe_test_mode" as const };
    }
    if (consumedEntitlements.length !== 1) {
      return { ok: false as const, code: "migration_requires_one_simulated_entitlement" as const };
    }
    const source = consumedEntitlements[0];
    const metadata = source.metadata && typeof source.metadata === "object"
      ? source.metadata as Row
      : {};
    if (
      readString(metadata.checkout_mode) !== "simulated"
      || metadata.billing_excluded !== true
    ) {
      return { ok: false as const, code: "migration_source_not_simulated" as const };
    }
    if (
      readString(source.plan_key).toLowerCase() !== input.planKey
      || readString(source.commercial_package_code).toLowerCase() !== input.planKey
    ) {
      return { ok: false as const, code: "migration_source_package_mismatch" as const };
    }
    sourceEntitlementId = readString(source.id);
    const authorizationId = readString(input.commercialMigrationAuthorizationId);
    if (!authorizationId) {
      return { ok: false as const, code: "commercial_migration_authorization_required" as const };
    }

    const { data: authorization, error: authorizationError } = await supabase
      .from("commercial_stripe_migration_authorizations")
      .select("id,client_id,account_id,source_entitlement_id,migration_kind,commercial_test_mode,status,expires_at")
      .eq("id", authorizationId)
      .eq("client_id", clientId)
      .eq("account_id", accountId)
      .eq("source_entitlement_id", sourceEntitlementId)
      .maybeSingle<Row>();
    if (authorizationError || !authorization?.id) {
      return { ok: false as const, code: "commercial_migration_authorization_invalid" as const };
    }
    if (
      readString(authorization.migration_kind) !== migrationKind
      || readString(authorization.commercial_test_mode) !== "stripe_test"
      || readString(authorization.status) !== "authorized"
      || Date.parse(readString(authorization.expires_at)) <= Date.now()
    ) {
      return { ok: false as const, code: "commercial_migration_authorization_ineligible" as const };
    }
    migrationAuthorizationId = authorizationId;

    const { data: migrations, error: migrationError } = await supabase
      .from("commercial_stripe_entitlement_migrations")
      .select("id,state")
      .eq("source_entitlement_id", sourceEntitlementId)
      .limit(1);
    if (migrationError) {
      return { ok: false as const, code: "commercial_migration_lookup_failed" as const };
    }
    if (Array.isArray(migrations) && migrations.length > 0) {
      return { ok: false as const, code: "commercial_migration_already_exists" as const };
    }
  } else if (migrationKind) {
    return { ok: false as const, code: "commercial_migration_kind_invalid" as const };
  }

  const { data: subscriptionRows, error: subscriptionError } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("id,status,stripe_subscription_id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .limit(1);
  if (subscriptionError) {
    return { ok: false as const, code: "target_subscription_lookup_failed" as const };
  }
  const activeSubscriptions = (subscriptionRows ?? []).filter((row) => ![
    "canceled",
    "cancelled",
    "incomplete_expired",
    "unpaid",
  ].includes(readString((row as Row).status).toLowerCase()));
  if (activeSubscriptions.length > 0) {
    return { ok: false as const, code: "target_modern_subscription_exists" as const };
  }

  return {
    ok: true as const,
    clientId,
    accountId,
    sourceEntitlementId,
    migrationAuthorizationId,
    commercialMigrationKind: migrationKind,
  };
}

export async function bindActivatedEntitlementToExistingAccount(
  supabase: SupabaseClient,
  input: { entitlementId: string; accountId: string; clientId: string },
) {
  const entitlement = await getEntitlementById(supabase, input.entitlementId);
  if (!entitlement || entitlement.clientId !== input.clientId) {
    throw new Error("entitlement_client_mismatch");
  }
  if (entitlement.status === "entitlement_consumed") {
    if (entitlement.accountId !== input.accountId) throw new Error("entitlement_account_mismatch");
    return entitlement;
  }
  if (entitlement.status !== "entitlement_reserved" || entitlement.accountId) {
    throw new Error("entitlement_not_bindable");
  }
  return markEntitlementConsumed(supabase, {
    entitlementId: input.entitlementId,
    accountId: input.accountId,
  });
}

export async function reconcileSimulatedToStripeTestEntitlement(
  supabase: SupabaseClient,
  input: {
    checkoutAttemptId: string;
    clientId: string;
    accountId: string;
    sourceEntitlementId: string;
    replacementEntitlementId: string;
    authorizationId: string;
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    stripePriceId: string;
    stripeCheckoutSessionId: string;
    stripeEventId: string;
    stripeLivemode: boolean | null;
    stripeMetadataClientId: string;
    stripeMetadataTargetAccountId: string;
    stripeMetadataSourceEntitlementId: string;
    stripeMetadataMigrationKind: string;
    stripeMetadataCommercialTestMode: string;
    stripeMetadataAuthorizationId: string;
  },
) {
  const { data, error } = await supabase.rpc("reconcile_simulated_to_stripe_test_v2", {
    p_checkout_attempt_id: input.checkoutAttemptId,
    p_client_id: input.clientId,
    p_account_id: input.accountId,
    p_source_entitlement_id: input.sourceEntitlementId,
    p_replacement_entitlement_id: input.replacementEntitlementId,
    p_authorization_id: input.authorizationId,
    p_stripe_subscription_id: input.stripeSubscriptionId,
    p_stripe_customer_id: input.stripeCustomerId,
    p_stripe_price_id: input.stripePriceId,
    p_stripe_checkout_session_id: input.stripeCheckoutSessionId,
    p_stripe_event_id: input.stripeEventId,
    p_stripe_livemode: input.stripeLivemode,
    p_stripe_metadata_client_id: input.stripeMetadataClientId,
    p_stripe_metadata_target_account_id: input.stripeMetadataTargetAccountId,
    p_stripe_metadata_source_entitlement_id: input.stripeMetadataSourceEntitlementId,
    p_stripe_metadata_migration_kind: input.stripeMetadataMigrationKind,
    p_stripe_metadata_commercial_test_mode: input.stripeMetadataCommercialTestMode,
    p_stripe_metadata_authorization_id: input.stripeMetadataAuthorizationId,
  });
  if (error) {
    return { ok: false as const, code: "simulated_to_stripe_reconciliation_failed" as const };
  }
  const payload = data && typeof data === "object" ? data as Row : {};
  if (payload.ok !== true) {
    return {
      ok: false as const,
      code: readString(payload.code, "simulated_to_stripe_reconciliation_rejected"),
    };
  }
  return {
    ok: true as const,
    idempotentReplay: payload.idempotent_replay === true,
    migrationId: readString(payload.migration_id) || null,
  };
}
