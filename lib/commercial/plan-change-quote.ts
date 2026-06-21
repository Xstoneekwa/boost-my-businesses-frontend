import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCommercialQuote } from "./pricing.ts";
import { buildPlanChangeProrationQuote } from "./plan-change-proration.ts";
import { evaluatePlanChangeCapacity } from "./plan-change-capacity.ts";
import { loadPlanChangeSource, clientVisiblePlanLabel } from "./plan-change-source.ts";
import { isPlanKey, type PlanKey } from "./catalog.ts";
import { evaluatePlanChangeActivation, planChangeActivationClientMessages } from "./plan-change-activation-guard.ts";

type Row = Record<string, unknown>;

const QUOTE_TTL_MS = 15 * 60 * 1000;

export type PlanChangeQuoteView = {
  quoteId: string;
  idempotencyKey: string;
  expiresAt: string;
  currentPlanLabel: string;
  currentPlanKey: PlanKey;
  targetPlanKey: PlanKey;
  targetPlanLabel: string;
  billingIntervalMonths: number;
  periodEndAt: string;
  periodStartAt: string;
  currency: "EUR";
  activeCommercialPeriodValueCents: number;
  currentUnusedCreditCents: number;
  targetFullPeriodPriceCents: number;
  targetRemainingCostCents: number;
  existingCustomerCreditCents: number;
  availableCreditCents: number;
  creditAppliedCents: number;
  amountDueCents: number;
  remainingCreditCents: number;
  remainingRatioBps: number;
  simulatedActivationAvailable: boolean;
  activationMessageFr: string | null;
  activationMessageEn: string | null;
};

function readNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export async function readClientCreditBalanceCents(
  supabase: SupabaseClient,
  clientId: string,
  currency = "EUR",
) {
  const { data, error } = await supabase
    .from("client_credit_ledger")
    .select("direction,amount_cents")
    .eq("client_id", clientId)
    .eq("currency", currency)
    .limit(5000);

  if (error || !Array.isArray(data)) return null;

  return (data as Row[]).reduce((sum, row) => {
    const amount = readNumber(row.amount_cents);
    return sum + (readString(row.direction) === "credit" ? amount : -amount);
  }, 0);
}

export async function createPlanChangeQuote(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    targetPlanKey: string;
    idempotencyKey: string;
  },
): Promise<
  | { ok: true; quote: PlanChangeQuoteView }
  | { ok: false; status: number; code: string; messageFr: string; messageEn: string }
> {
  if (!isPlanKey(input.targetPlanKey)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_plan_key",
      messageFr: "Formule sélectionnée invalide.",
      messageEn: "Invalid selected plan.",
    };
  }

  const sourceResult = await loadPlanChangeSource(supabase, input.clientId);
  if (!sourceResult.ok) {
    const messages: Record<string, { fr: string; en: string }> = {
      source_not_found: {
        fr: "Aucun abonnement actif trouvé pour changer de formule.",
        en: "No active subscription found to change plan.",
      },
      source_ambiguous_entitlement: {
        fr: "Plusieurs abonnements actifs ont été détectés. Contactez le support pour modifier votre formule.",
        en: "Multiple active subscriptions were detected. Contact support to change your plan.",
      },
      source_ambiguous_pricing: {
        fr: "Le montant payé d'origine est indisponible. Contactez le support pour modifier votre formule.",
        en: "Original paid amount is unavailable. Contact support to change your plan.",
      },
      source_currency_unsupported: {
        fr: "Changement de formule indisponible pour cette devise. Contactez le support.",
        en: "Plan change is unavailable for this currency. Contact support.",
      },
      source_period_invalid: {
        fr: "La période d'abonnement actuelle est invalide. Contactez le support.",
        en: "Current subscription period is invalid. Contact support.",
      },
      source_inactive: {
        fr: "Votre abonnement actif n'est plus éligible au changement de formule.",
        en: "Your active subscription is no longer eligible for plan change.",
      },
    };
    const msg = messages[sourceResult.code] ?? messages.source_not_found;
    return {
      ok: false,
      status: 409,
      code: sourceResult.code,
      messageFr: msg.fr,
      messageEn: msg.en,
    };
  }

  const source = sourceResult.source;
  if (source.currentPlanKey === input.targetPlanKey) {
    return {
      ok: false,
      status: 400,
      code: "same_plan_selected",
      messageFr: "Vous êtes déjà sur cette formule.",
      messageEn: "You are already on this plan.",
    };
  }

  const capacity = await evaluatePlanChangeCapacity(supabase, input.clientId, input.targetPlanKey);
  if (!capacity.ok) {
    return {
      ok: false,
      status: 409,
      code: capacity.code,
      messageFr: capacity.messageFr,
      messageEn: capacity.messageEn,
    };
  }

  const existingCustomerCreditCents = await readClientCreditBalanceCents(supabase, input.clientId, source.currency);
  if (existingCustomerCreditCents == null) {
    return {
      ok: false,
      status: 503,
      code: "credit_ledger_unavailable",
      messageFr: "Impossible de calculer votre avoir client pour le moment.",
      messageEn: "Could not compute your client credit balance right now.",
    };
  }

  const catalogQuote = buildCommercialQuote({
    planKey: input.targetPlanKey,
    billingIntervalMonths: source.billingIntervalMonths,
    outreachAddonKey: null,
    billableAccountCount: source.billableAccountCount,
  });
  if ("error" in catalogQuote) {
    return {
      ok: false,
      status: 400,
      code: catalogQuote.error,
      messageFr: "Formule sélectionnée invalide.",
      messageEn: "Invalid selected plan.",
    };
  }

  const proration = buildPlanChangeProrationQuote({
    activeCommercialPeriodValueCents: source.activeCommercialPeriodValueCents,
    targetFullPeriodPriceCents: catalogQuote.totalPeriodCents,
    periodStartAt: source.periodStartAt,
    periodEndAt: source.periodEndAt,
    existingCustomerCreditCents,
  });

  const activationEval = evaluatePlanChangeActivation({
    amountDueCents: proration.amountDueCents,
    actorEmail: source.purchaserEmail,
    paymentStatus: null,
  });
  const activationMessages = !activationEval.ok
    ? planChangeActivationClientMessages(activationEval.reason)
    : null;

  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("commercial_plan_change_quotes")
    .insert({
      client_id: input.clientId,
      idempotency_key: input.idempotencyKey,
      source_entitlement_id: source.sourceEntitlementId,
      source_checkout_session_id: source.sourceCheckoutSessionId,
      source_plan_key: source.currentPlanKey,
      target_plan_key: input.targetPlanKey,
      billing_interval_months: source.billingIntervalMonths,
      currency: source.currency,
      period_start_at: source.periodStartAt,
      period_end_at: source.periodEndAt,
      active_commercial_period_value_cents: source.activeCommercialPeriodValueCents,
      remaining_ratio_bps: proration.remainingRatioBps,
      current_unused_credit_cents: proration.currentUnusedCreditCents,
      target_full_period_price_cents: catalogQuote.totalPeriodCents,
      target_remaining_cost_cents: proration.targetRemainingCostCents,
      existing_customer_credit_cents: proration.existingCustomerCreditCents,
      available_credit_cents: proration.availableCreditCents,
      credit_applied_cents: proration.creditAppliedCents,
      amount_due_cents: proration.amountDueCents,
      remaining_credit_cents: proration.remainingCreditCents,
      source_revision: source.sourceRevision,
      status: "quote_pending",
      quote_expires_at: expiresAt,
      payment_provider: null,
      payment_status: proration.amountDueCents > 0 ? "pending" : "not_required",
      metadata: {
        checkout_context: "existing_workspace_plan_change",
      },
    })
    .select("id,quote_expires_at")
    .maybeSingle<Row>();

  if (insertError || !inserted?.id) {
    if (insertError?.code === "23505") {
      const { data: existing } = await supabase
        .from("commercial_plan_change_quotes")
        .select("*")
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle<Row>();
      if (existing?.id && readString(existing.status) === "quote_pending") {
        return {
          ok: true,
          quote: mapQuoteRow(existing, source.currentPlanKey, input.targetPlanKey as PlanKey, activationEval),
        };
      }
    }
    return {
      ok: false,
      status: 503,
      code: "quote_storage_unavailable",
      messageFr: "Impossible d'enregistrer le devis de changement de formule.",
      messageEn: "Could not store the plan change quote.",
    };
  }

  return {
    ok: true,
    quote: buildQuoteView(
      {
        id: inserted.id,
        idempotency_key: input.idempotencyKey,
        quote_expires_at: readString(inserted.quote_expires_at, expiresAt),
        target_full_period_price_cents: catalogQuote.totalPeriodCents,
      },
      source,
      input.targetPlanKey as PlanKey,
      proration,
      activationEval,
      expiresAt,
    ),
  };
}

function buildQuoteView(
  row: Row,
  source: { currentPlanKey: PlanKey; billingIntervalMonths: number; periodEndAt: string; periodStartAt: string; currency: "EUR"; activeCommercialPeriodValueCents: number },
  targetPlanKey: PlanKey,
  proration: ReturnType<typeof buildPlanChangeProrationQuote>,
  activationEval: ReturnType<typeof evaluatePlanChangeActivation>,
  expiresAt: string,
): PlanChangeQuoteView {
  const activationMessages = !activationEval.ok
    ? planChangeActivationClientMessages(activationEval.reason)
    : null;
  return {
    quoteId: readString(row.id),
    idempotencyKey: readString(row.idempotency_key),
    expiresAt: readString(row.quote_expires_at, expiresAt),
    currentPlanLabel: clientVisiblePlanLabel(source.currentPlanKey),
    currentPlanKey: source.currentPlanKey,
    targetPlanKey,
    targetPlanLabel: clientVisiblePlanLabel(targetPlanKey),
    billingIntervalMonths: source.billingIntervalMonths,
    periodEndAt: source.periodEndAt,
    periodStartAt: source.periodStartAt,
    currency: source.currency,
    activeCommercialPeriodValueCents: source.activeCommercialPeriodValueCents,
    currentUnusedCreditCents: proration.currentUnusedCreditCents,
    targetFullPeriodPriceCents: readNumber(row.target_full_period_price_cents),
    targetRemainingCostCents: proration.targetRemainingCostCents,
    existingCustomerCreditCents: proration.existingCustomerCreditCents,
    availableCreditCents: proration.availableCreditCents,
    creditAppliedCents: proration.creditAppliedCents,
    amountDueCents: proration.amountDueCents,
    remainingCreditCents: proration.remainingCreditCents,
    remainingRatioBps: proration.remainingRatioBps,
    simulatedActivationAvailable: activationEval.ok && activationEval.mode === "simulated_test",
    activationMessageFr: activationMessages?.messageFr ?? null,
    activationMessageEn: activationMessages?.messageEn ?? null,
  };
}

function mapQuoteRow(
  row: Row,
  currentPlanKey: PlanKey,
  targetPlanKey: PlanKey,
  activationEval: ReturnType<typeof evaluatePlanChangeActivation>,
): PlanChangeQuoteView {
  const activationMessages = !activationEval.ok
    ? planChangeActivationClientMessages(activationEval.reason)
    : null;
  return {
    quoteId: readString(row.id),
    idempotencyKey: readString(row.idempotency_key),
    expiresAt: readString(row.quote_expires_at),
    currentPlanLabel: clientVisiblePlanLabel(currentPlanKey),
    currentPlanKey,
    targetPlanKey,
    targetPlanLabel: clientVisiblePlanLabel(targetPlanKey),
    billingIntervalMonths: readNumber(row.billing_interval_months),
    periodEndAt: readString(row.period_end_at),
    periodStartAt: readString(row.period_start_at),
    currency: "EUR",
    activeCommercialPeriodValueCents: readNumber(row.active_commercial_period_value_cents),
    currentUnusedCreditCents: readNumber(row.current_unused_credit_cents),
    targetFullPeriodPriceCents: readNumber(row.target_full_period_price_cents),
    targetRemainingCostCents: readNumber(row.target_remaining_cost_cents),
    existingCustomerCreditCents: readNumber(row.existing_customer_credit_cents),
    availableCreditCents: readNumber(row.available_credit_cents),
    creditAppliedCents: readNumber(row.credit_applied_cents),
    amountDueCents: readNumber(row.amount_due_cents),
    remainingCreditCents: readNumber(row.remaining_credit_cents),
    remainingRatioBps: readNumber(row.remaining_ratio_bps),
    simulatedActivationAvailable: activationEval.ok && activationEval.mode === "simulated_test",
    activationMessageFr: activationMessages?.messageFr ?? null,
    activationMessageEn: activationMessages?.messageEn ?? null,
  };
}

export async function activatePlanChangeQuote(
  supabase: SupabaseClient,
  input: {
    quoteId: string;
    idempotencyKey: string;
    actorEmail?: string | null;
    simulatedActivation?: boolean;
  },
): Promise<
  | { ok: true; idempotentReplay: boolean; clientId: string; checkoutSessionId: string | null }
  | { ok: false; status: number; code: string; messageFr: string; messageEn: string }
> {
  const { data, error } = await supabase.rpc("activate_commercial_plan_change", {
    p_quote_id: input.quoteId,
    p_idempotency_key: input.idempotencyKey,
    p_actor_email: input.actorEmail ?? null,
    p_simulated_activation: Boolean(input.simulatedActivation),
  });

  if (error) {
    return {
      ok: false,
      status: 503,
      code: "plan_change_activation_unavailable",
      messageFr: "Activation du changement de formule indisponible pour le moment.",
      messageEn: "Plan change activation is unavailable right now.",
    };
  }

  const payload = (data && typeof data === "object") ? data as Row : {};
  if (!payload.ok) {
    const code = readString(payload.code, "plan_change_failed");
    const messages: Record<string, { fr: string; en: string; status: number }> = {
      quote_expired: {
        fr: "Ce devis a expiré. Recalculez votre changement de formule.",
        en: "This quote has expired. Recalculate your plan change.",
        status: 409,
      },
      quote_stale: {
        fr: "Votre abonnement a changé depuis le devis. Recalculez votre changement de formule.",
        en: "Your subscription changed since the quote. Recalculate your plan change.",
        status: 409,
      },
      credit_balance_changed: {
        fr: "Votre avoir client a changé depuis le devis. Recalculez votre changement de formule.",
        en: "Your client credit changed since the quote. Recalculate your plan change.",
        status: 409,
      },
      quote_not_found: {
        fr: "Devis introuvable.",
        en: "Quote not found.",
        status: 404,
      },
      idempotency_mismatch: {
        fr: "Confirmation invalide pour ce devis.",
        en: "Invalid confirmation for this quote.",
        status: 409,
      },
      payment_required: {
        fr: "Un paiement est requis avant d'activer ce changement de formule.",
        en: "Payment is required before activating this plan change.",
        status: 402,
      },
      source_missing: {
        fr: "Abonnement source introuvable.",
        en: "Source subscription not found.",
        status: 409,
      },
    };
    const msg = messages[code] ?? {
      fr: "Impossible de confirmer le changement de formule.",
      en: "Could not confirm the plan change.",
      status: 409,
    };
    return { ok: false, status: msg.status, code, messageFr: msg.fr, messageEn: msg.en };
  }

  return {
    ok: true,
    idempotentReplay: Boolean(payload.idempotent_replay),
    clientId: readString(payload.client_id),
    checkoutSessionId: readString(payload.checkout_session_id) || null,
  };
}
