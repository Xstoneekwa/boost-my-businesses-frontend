import type { BillingIntervalMonths, PlanKey } from "./catalog.ts";

export type PlanChangeProrationInput = {
  activeCommercialPeriodValueCents: number;
  targetFullPeriodPriceCents: number;
  periodStartAt: string;
  periodEndAt: string;
  effectiveChangeAt?: string;
  existingCustomerCreditCents?: number;
};

export type PlanChangeProrationResult = {
  remainingRatioBps: number;
  currentUnusedCreditCents: number;
  targetRemainingCostCents: number;
  existingCustomerCreditCents: number;
  availableCreditCents: number;
  creditAppliedCents: number;
  amountDueCents: number;
  remainingCreditCents: number;
};

const BPS_SCALE = 10_000;

export function roundPlanChangeCents(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function computeRemainingRatioBps(input: {
  periodStartAt: string;
  periodEndAt: string;
  effectiveChangeAt: string;
}) {
  const startMs = Date.parse(input.periodStartAt);
  const endMs = Date.parse(input.periodEndAt);
  const nowMs = Date.parse(input.effectiveChangeAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(nowMs)) return 0;
  if (endMs <= startMs) return 0;
  if (nowMs >= endMs) return 0;
  if (nowMs <= startMs) return BPS_SCALE;
  const remainingMs = endMs - nowMs;
  const totalMs = endMs - startMs;
  return Math.min(BPS_SCALE, Math.max(0, Math.round((remainingMs / totalMs) * BPS_SCALE)));
}

export function applyRemainingRatioBps(amountCents: number, remainingRatioBps: number) {
  return roundPlanChangeCents((amountCents * remainingRatioBps) / BPS_SCALE);
}

export function buildPlanChangeProrationQuote(input: PlanChangeProrationInput): PlanChangeProrationResult {
  const effectiveChangeAt = input.effectiveChangeAt ?? new Date().toISOString();
  const remainingRatioBps = computeRemainingRatioBps({
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
    effectiveChangeAt,
  });

  const currentUnusedCreditCents = applyRemainingRatioBps(input.activeCommercialPeriodValueCents, remainingRatioBps);
  const targetRemainingCostCents = applyRemainingRatioBps(input.targetFullPeriodPriceCents, remainingRatioBps);
  const existingCustomerCreditCents = roundPlanChangeCents(input.existingCustomerCreditCents ?? 0);
  const availableCreditCents = existingCustomerCreditCents + currentUnusedCreditCents;
  const creditAppliedCents = Math.min(availableCreditCents, targetRemainingCostCents);
  const amountDueCents = Math.max(0, targetRemainingCostCents - availableCreditCents);
  const remainingCreditCents = Math.max(0, availableCreditCents - targetRemainingCostCents);

  return {
    remainingRatioBps,
    currentUnusedCreditCents,
    targetRemainingCostCents,
    existingCustomerCreditCents,
    availableCreditCents,
    creditAppliedCents,
    amountDueCents,
    remainingCreditCents,
  };
}

export function addCalendarMonthsUtcIso(iso: string, months: BillingIntervalMonths) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const target = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
  return target.toISOString();
}

export function isDownsell(fromPlan: PlanKey, toPlan: PlanKey) {
  const rank: Record<PlanKey, number> = { growth: 1, pro: 2, premium: 3 };
  return rank[toPlan] < rank[fromPlan];
}
