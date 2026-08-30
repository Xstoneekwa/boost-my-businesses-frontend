import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMERCIAL_PLANS,
  type BillingIntervalMonths,
  type OutreachAddonKey,
  type PlanKey,
  isBillingIntervalMonths,
  isOutreachAddonKey,
  isPlanKey,
} from "./catalog.ts";
import { addCalendarMonthsUtcIso } from "./plan-change-proration.ts";
import { resolveActiveCommercialPeriodValueCents } from "./plan-change-commercial-value.ts";
import { assertPlanChangeAccountEligible } from "./plan-change-account-eligibility.ts";

type Row = Record<string, unknown>;

export type PlanChangeSource = {
  clientId: string;
  accountId: string;
  sourceEntitlementId: string;
  sourceCheckoutSessionId: string;
  currentPlanKey: PlanKey;
  billingIntervalMonths: BillingIntervalMonths;
  currency: "EUR";
  periodStartAt: string;
  periodEndAt: string;
  activeCommercialPeriodValueCents: number;
  sourceRevision: string;
  purchaserEmail: string;
  billableAccountCount: number;
  outreachAddonKey: OutreachAddonKey | null;
  changeScope: "per_account";
  activationMode: "simulated_test" | "stripe_test";
};

export type PlanChangeSourceErrorCode =
  | "source_not_found"
  | "source_ambiguous_entitlement"
  | "source_ambiguous_pricing"
  | "source_currency_unsupported"
  | "source_period_invalid"
  | "source_inactive"
  | "source_revision_unavailable";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readMetadataString(metadata: unknown, key: string, fallback = "") {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return fallback;
  return readString((metadata as Row)[key], fallback);
}

function isWorkspaceCommercialEntitlement(row: Row) {
  if (readString(row.account_id)) return false;
  if (readString(row.status) === "entitlement_cancelled") return false;
  if (readMetadataString(row.metadata, "superseded_at")) return false;
  return true;
}

function isWorkspaceCommercialSession(row: Row) {
  const flowType = readString(row.flow_type);
  if (!["first_purchase", "plan_change"].includes(flowType)) return false;
  if (readString(row.status) !== "checkout_activated_test") return false;
  return true;
}

export async function loadCommercialPlanChangeSourceRevision(
  supabase: SupabaseClient,
  input: {
    entitlementId: string;
    sessionId: string;
    activeCommercialPeriodValueCents: number;
    accountId?: string | null;
  },
): Promise<string | null> {
  if (input.accountId) {
    const { data, error } = await supabase.rpc("commercial_plan_change_source_revision_for_account_source", {
      p_entitlement_id: input.entitlementId,
      p_session_id: input.sessionId,
      p_account_id: input.accountId,
      p_active_commercial_period_value_cents: input.activeCommercialPeriodValueCents,
    });
    if (error || typeof data !== "string" || !data.trim()) return null;
    return data.trim();
  }

  const { data, error } = await supabase.rpc("commercial_plan_change_source_revision_for_source", {
    p_entitlement_id: input.entitlementId,
    p_session_id: input.sessionId,
    p_active_commercial_period_value_cents: input.activeCommercialPeriodValueCents,
  });

  if (error || typeof data !== "string" || !data.trim()) {
    return null;
  }

  return data.trim();
}

export function resolvePeriodEndAt(periodStartAt: string, billingIntervalMonths: BillingIntervalMonths) {
  return addCalendarMonthsUtcIso(periodStartAt, billingIntervalMonths);
}

export function resolveCanonicalWorkspaceCommercialSource(input: {
  entitlements: Row[];
  sessionsById: Map<string, Row>;
  clientId: string;
}):
  | { ok: true; entitlement: Row; session: Row }
  | { ok: false; code: PlanChangeSourceErrorCode } {
  const candidates: Array<{ entitlement: Row; session: Row }> = [];

  for (const entitlement of input.entitlements) {
    if (!isWorkspaceCommercialEntitlement(entitlement)) continue;
    if (readString(entitlement.client_id) && readString(entitlement.client_id) !== input.clientId) continue;

    const sessionId = readString(entitlement.checkout_session_id);
    const session = sessionId ? input.sessionsById.get(sessionId) : undefined;
    if (!session || !isWorkspaceCommercialSession(session)) continue;
    if (readString(session.client_id) && readString(session.client_id) !== input.clientId) continue;

    const entitlementMetadata = entitlement.metadata && typeof entitlement.metadata === "object"
      ? entitlement.metadata as Row
      : null;
    const sessionMetadata = session.metadata && typeof session.metadata === "object"
      ? session.metadata as Row
      : null;

    const workspacePlan = readMetadataString(entitlementMetadata, "workspace_plan") === "true"
      || readString(session.flow_type) === "plan_change"
      || readString(session.flow_type) === "first_purchase";

    if (!workspacePlan) continue;

    const commercialValue = resolveActiveCommercialPeriodValueCents({ session, entitlement });
    if (commercialValue == null || commercialValue <= 0) continue;

    if (readMetadataString(sessionMetadata, "period_end_at")) {
      // explicit period end from plan change lineage
    }

    candidates.push({ entitlement, session });
  }

  if (candidates.length === 0) {
    return { ok: false, code: "source_not_found" };
  }

  if (candidates.length > 1) {
    return { ok: false, code: "source_ambiguous_entitlement" };
  }

  return { ok: true, entitlement: candidates[0].entitlement, session: candidates[0].session };
}

function isAccountCommercialEntitlement(row: Row) {
  if (!readString(row.account_id)) return false;
  if (readString(row.status) !== "entitlement_consumed") return false;
  if (readMetadataString(row.metadata, "superseded_at")) return false;
  return true;
}

function isCommercialCheckoutSession(row: Row) {
  const flowType = readString(row.flow_type);
  if (!["first_purchase", "additional_account", "plan_change"].includes(flowType)) return false;
  if (!["checkout_activated_test", "checkout_paid"].includes(readString(row.status))) return false;
  return true;
}

export function resolveAccountCommercialSessionMode(input: {
  session: Row;
  subscriptions: Row[];
  clientId: string;
  accountId: string;
  entitlementId: string;
}): "simulated_test" | "stripe_test" | null {
  if (readString(input.session.status) === "checkout_activated_test") return "simulated_test";
  if (readString(input.session.status) !== "checkout_paid") return null;

  const sessionId = readString(input.session.id);
  const matches = input.subscriptions.filter((row) => (
    readString(row.client_id) === input.clientId
    && readString(row.account_id) === input.accountId
    && readString(row.client_account_entitlement_id) === input.entitlementId
    && readString(row.commercial_checkout_session_id) === sessionId
    && ["active", "trialing"].includes(readString(row.status).toLowerCase())
    && row.livemode === false
    && Boolean(readString(row.stripe_subscription_id))
  ));

  return matches.length === 1 ? "stripe_test" : null;
}

export async function loadPlanChangeSourceForAccount(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    accountId: string;
    sourceEntitlementId?: string | null;
  },
): Promise<{ ok: true; source: PlanChangeSource } | { ok: false; code: PlanChangeSourceErrorCode | string }> {
  const eligibility = await assertPlanChangeAccountEligible(supabase, input);
  if (!eligibility.ok) {
    const codeMap: Record<string, PlanChangeSourceErrorCode> = {
      entitlement_not_found: "source_not_found",
      entitlement_not_consumed: "source_inactive",
      entitlement_reserved: "source_inactive",
      source_inactive: "source_inactive",
    };
    return { ok: false, code: codeMap[eligibility.code] ?? eligibility.code };
  }

  const { data: entitlement, error: entitlementError } = await supabase
    .from("client_account_entitlements")
    .select(`
      id,
      client_id,
      checkout_session_id,
      plan_key,
      billing_interval_months,
      status,
      account_id,
      outreach_addon_key,
      consumed_at,
      pack_period_total_cents,
      updated_at,
      created_at,
      metadata
    `)
    .eq("id", eligibility.sourceEntitlementId)
    .eq("client_id", input.clientId)
    .eq("account_id", input.accountId)
    .maybeSingle<Row>();

  if (entitlementError || !entitlement?.id || !isAccountCommercialEntitlement(entitlement)) {
    return { ok: false, code: "source_not_found" };
  }

  const sessionId = readString(entitlement.checkout_session_id);
  if (!sessionId) return { ok: false, code: "source_not_found" };

  const { data: sessionRow, error: sessionError } = await supabase
    .from("commercial_checkout_sessions")
    .select(`
      id,
      client_id,
      flow_type,
      status,
      plan_key,
      billing_interval_months,
      total_period_cents,
      pack_period_total_cents,
      activated_at,
      created_at,
      updated_at,
      purchaser_email,
      billable_account_count,
      metadata
    `)
    .eq("id", sessionId)
    .maybeSingle<Row>();

  if (sessionError || !sessionRow?.id || !isCommercialCheckoutSession(sessionRow)) {
    return { ok: false, code: "source_not_found" };
  }

  if (readString(sessionRow.client_id) && readString(sessionRow.client_id) !== input.clientId) {
    return { ok: false, code: "source_not_found" };
  }

  let stripeSubscriptions: Row[] = [];
  if (readString(sessionRow.status) === "checkout_paid") {
    const { data: subscriptionRows, error: subscriptionError } = await supabase
      .from("commercial_stripe_subscriptions")
      .select(`
        client_id,
        account_id,
        client_account_entitlement_id,
        commercial_checkout_session_id,
        stripe_subscription_id,
        status,
        livemode
      `)
      .eq("client_id", input.clientId)
      .eq("account_id", input.accountId)
      .eq("client_account_entitlement_id", readString(entitlement.id))
      .eq("commercial_checkout_session_id", readString(sessionRow.id))
      .in("status", ["active", "trialing"])
      .eq("livemode", false)
      .limit(2);
    if (subscriptionError) return { ok: false, code: "source_not_found" };
    stripeSubscriptions = Array.isArray(subscriptionRows) ? subscriptionRows as Row[] : [];
  }

  const activationMode = resolveAccountCommercialSessionMode({
    session: sessionRow,
    subscriptions: stripeSubscriptions,
    clientId: input.clientId,
    accountId: input.accountId,
    entitlementId: readString(entitlement.id),
  });
  if (!activationMode) return { ok: false, code: "source_not_found" };

  const planKeyRaw = readString(entitlement.plan_key || sessionRow.plan_key).toLowerCase();
  if (!isPlanKey(planKeyRaw)) return { ok: false, code: "source_ambiguous_pricing" };

  const billingIntervalMonths = readNumber(entitlement.billing_interval_months ?? sessionRow.billing_interval_months, 0);
  if (!isBillingIntervalMonths(billingIntervalMonths)) return { ok: false, code: "source_period_invalid" };

  const activeCommercialPeriodValueCents = resolveActiveCommercialPeriodValueCents({ session: sessionRow, entitlement });
  if (activeCommercialPeriodValueCents == null || activeCommercialPeriodValueCents <= 0) {
    return { ok: false, code: "source_ambiguous_pricing" };
  }

  const sessionMetadata = sessionRow.metadata && typeof sessionRow.metadata === "object"
    ? sessionRow.metadata as Row
    : null;
  const entitlementMetadata = entitlement.metadata && typeof entitlement.metadata === "object"
    ? entitlement.metadata as Row
    : null;

  const periodStartAt = readString(entitlement.consumed_at)
    || readString(sessionRow.activated_at)
    || readString(sessionRow.created_at)
    || readString(entitlement.created_at);
  if (!periodStartAt) return { ok: false, code: "source_period_invalid" };

  const periodEndAt = readMetadataString(entitlementMetadata, "period_end_at")
    || readMetadataString(sessionMetadata, "period_end_at")
    || resolvePeriodEndAt(periodStartAt, billingIntervalMonths);
  if (!periodEndAt) return { ok: false, code: "source_period_invalid" };

  const currency = readMetadataString(sessionMetadata, "currency", "EUR").toUpperCase();
  if (currency !== "EUR") return { ok: false, code: "source_currency_unsupported" };

  const outreachRaw = readString(entitlement.outreach_addon_key).toLowerCase();
  const outreachAddonKey = isOutreachAddonKey(outreachRaw) ? outreachRaw : null;

  const sourceRevision = await loadCommercialPlanChangeSourceRevision(supabase, {
    entitlementId: readString(entitlement.id),
    sessionId: readString(sessionRow.id),
    activeCommercialPeriodValueCents,
    accountId: input.accountId,
  });
  if (!sourceRevision) {
    return { ok: false, code: "source_revision_unavailable" };
  }

  return {
    ok: true,
    source: {
      clientId: input.clientId,
      accountId: input.accountId,
      sourceEntitlementId: readString(entitlement.id),
      sourceCheckoutSessionId: readString(sessionRow.id),
      currentPlanKey: planKeyRaw,
      billingIntervalMonths,
      currency: "EUR",
      periodStartAt,
      periodEndAt,
      activeCommercialPeriodValueCents,
      sourceRevision,
      purchaserEmail: readString(sessionRow.purchaser_email),
      billableAccountCount: Math.max(1, readNumber(sessionRow.billable_account_count, 1)),
      outreachAddonKey,
      changeScope: "per_account",
      activationMode,
    },
  };
}

/** @deprecated Legacy workspace-wide source. New plan-change quotes must use loadPlanChangeSourceForAccount. */
export async function loadPlanChangeSource(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ ok: true; source: Omit<PlanChangeSource, "accountId" | "changeScope" | "outreachAddonKey"> & { accountId?: never } } | { ok: false; code: PlanChangeSourceErrorCode }> {
  const { data: entitlementRows, error: entitlementError } = await supabase
    .from("client_account_entitlements")
    .select(`
      id,
      client_id,
      checkout_session_id,
      plan_key,
      billing_interval_months,
      status,
      account_id,
      pack_period_total_cents,
      updated_at,
      created_at,
      metadata
    `)
    .eq("client_id", clientId)
    .in("status", ["entitlement_reserved", "entitlement_consumed"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (entitlementError) return { ok: false, code: "source_not_found" };

  const entitlements = Array.isArray(entitlementRows) ? entitlementRows as Row[] : [];
  const sessionIds = [...new Set(entitlements.map((row) => readString(row.checkout_session_id)).filter(Boolean))];
  if (!sessionIds.length) return { ok: false, code: "source_not_found" };

  const { data: sessionRows, error: sessionError } = await supabase
    .from("commercial_checkout_sessions")
    .select(`
      id,
      client_id,
      flow_type,
      status,
      plan_key,
      billing_interval_months,
      total_period_cents,
      pack_period_total_cents,
      activated_at,
      created_at,
      updated_at,
      purchaser_email,
      billable_account_count,
      metadata
    `)
    .in("id", sessionIds);

  if (sessionError) return { ok: false, code: "source_not_found" };

  const sessionsById = new Map(
    (Array.isArray(sessionRows) ? sessionRows as Row[] : []).map((row) => [readString(row.id), row]),
  );

  const resolved = resolveCanonicalWorkspaceCommercialSource({ entitlements, sessionsById, clientId });
  if (!resolved.ok) return resolved;

  const { entitlement, session: sessionRow } = resolved;

  const planKeyRaw = readString(entitlement.plan_key || sessionRow.plan_key).toLowerCase();
  if (!isPlanKey(planKeyRaw)) return { ok: false, code: "source_ambiguous_pricing" };

  const billingIntervalMonths = readNumber(entitlement.billing_interval_months ?? sessionRow.billing_interval_months, 0);
  if (!isBillingIntervalMonths(billingIntervalMonths)) return { ok: false, code: "source_period_invalid" };

  const activeCommercialPeriodValueCents = resolveActiveCommercialPeriodValueCents({ session: sessionRow, entitlement });
  if (activeCommercialPeriodValueCents == null || activeCommercialPeriodValueCents <= 0) {
    return { ok: false, code: "source_ambiguous_pricing" };
  }

  const sessionMetadata = sessionRow.metadata && typeof sessionRow.metadata === "object"
    ? sessionRow.metadata as Row
    : null;
  const entitlementMetadata = entitlement.metadata && typeof entitlement.metadata === "object"
    ? entitlement.metadata as Row
    : null;

  const periodStartAt = readString(sessionRow.activated_at)
    || readString(sessionRow.created_at)
    || readString(entitlement.created_at);
  if (!periodStartAt) return { ok: false, code: "source_period_invalid" };

  const periodEndAt = readMetadataString(entitlementMetadata, "period_end_at")
    || readMetadataString(sessionMetadata, "period_end_at")
    || resolvePeriodEndAt(periodStartAt, billingIntervalMonths);
  if (!periodEndAt) return { ok: false, code: "source_period_invalid" };

  const currency = readMetadataString(sessionMetadata, "currency", "EUR").toUpperCase();
  if (currency !== "EUR") return { ok: false, code: "source_currency_unsupported" };

  if (readString(entitlement.status) === "entitlement_cancelled") {
    return { ok: false, code: "source_inactive" };
  }

  const sourceRevision = await loadCommercialPlanChangeSourceRevision(supabase, {
    entitlementId: readString(entitlement.id),
    sessionId: readString(sessionRow.id),
    activeCommercialPeriodValueCents,
  });
  if (!sourceRevision) {
    return { ok: false, code: "source_revision_unavailable" };
  }

  return {
    ok: true,
    source: {
      clientId,
      sourceEntitlementId: readString(entitlement.id),
      sourceCheckoutSessionId: readString(sessionRow.id),
      currentPlanKey: planKeyRaw,
      billingIntervalMonths,
      currency: "EUR",
      periodStartAt,
      periodEndAt,
      activeCommercialPeriodValueCents,
      sourceRevision,
      purchaserEmail: readString(sessionRow.purchaser_email),
      billableAccountCount: Math.max(1, readNumber(sessionRow.billable_account_count, 1)),
      activationMode: "simulated_test",
    },
  };
}

export function clientVisiblePlanLabel(planKey: PlanKey) {
  return COMMERCIAL_PLANS[planKey].displayName;
}
