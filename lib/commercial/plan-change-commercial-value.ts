type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readMetadataNumber(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  return readNumber((metadata as Row)[key], 0);
}

/**
 * Commercial full-period value used for proration (never cash collected on plan_change).
 *
 * Priority:
 * 1. entitlement.pack_period_total_cents
 * 2. session.pack_period_total_cents
 * 3. session.metadata.commercial_period_value_cents / full_period_price_cents
 * 4. first_purchase only: session.total_period_cents (cash == commercial)
 */
export function resolveActiveCommercialPeriodValueCents(input: {
  session: Row;
  entitlement: Row;
}): number | null {
  const entitlementValue = readNumber(input.entitlement.pack_period_total_cents, 0);
  if (entitlementValue > 0) return entitlementValue;

  const sessionPackValue = readNumber(input.session.pack_period_total_cents, 0);
  if (sessionPackValue > 0) return sessionPackValue;

  const sessionMetadata = input.session.metadata && typeof input.session.metadata === "object"
    ? input.session.metadata as Row
    : null;
  const metadataValue = readMetadataNumber(sessionMetadata, "commercial_period_value_cents")
    || readMetadataNumber(sessionMetadata, "full_period_price_cents");
  if (metadataValue > 0) return metadataValue;

  const flowType = readString(input.session.flow_type);
  if (flowType === "first_purchase") {
    const cashValue = readNumber(input.session.total_period_cents, -1);
    return cashValue >= 0 ? cashValue : null;
  }

  if (flowType === "plan_change") {
    return null;
  }

  const fallback = readNumber(input.session.total_period_cents, -1);
  return fallback >= 0 ? fallback : null;
}

export function resolveCashCollectedCents(session: Row) {
  const metadata = session.metadata && typeof session.metadata === "object" ? session.metadata as Row : null;
  const fromMetadata = readMetadataNumber(metadata, "cash_collected_cents")
    || readMetadataNumber(metadata, "amount_due_cents");
  if (fromMetadata > 0) return fromMetadata;
  if (readString(session.flow_type) === "plan_change") {
    return readNumber(session.total_period_cents, 0);
  }
  return readNumber(session.total_period_cents, 0);
}

export function buildCommercialAccountingSnapshot(input: {
  fullPeriodPriceCents: number;
  targetRemainingCostCents: number;
  currentUnusedCreditCents: number;
  creditAppliedCents: number;
  amountDueCents: number;
  remainingCreditCents: number;
}) {
  return {
    commercial_period_value_cents: input.fullPeriodPriceCents,
    full_period_price_cents: input.fullPeriodPriceCents,
    target_remaining_cost_cents: input.targetRemainingCostCents,
    current_unused_credit_cents: input.currentUnusedCreditCents,
    credit_applied_cents: input.creditAppliedCents,
    amount_due_cents: input.amountDueCents,
    remaining_credit_cents: input.remainingCreditCents,
    cash_collected_cents: input.amountDueCents,
  };
}
