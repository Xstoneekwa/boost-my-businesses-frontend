import { deriveAgencyModeSnapshot } from "./agency.ts";

export type CommercialPricingContext =
  | "first_purchase"
  | "new_account"
  | "plan_change"
  | "dashboard_readonly";

export type CommercialAccountCounts = {
  /** Linked Instagram accounts on the workspace (`client_instagram_accounts`). */
  agencyDisplayCount: number;
  /** Same as linked count; used for Mode Agence (>= 2). */
  linkedAccountCount: number;
  reservedEntitlementCount: number;
  /** Engaged linked + reserved slots, plus at most one projected purchase for quotes. */
  billableAccountCount: number;
  /** Extra slot priced in the current quote when not already represented by reserved. */
  projectedPurchaseSlots: number;
  agencyModeActive: boolean;
};

/**
 * How many additional commercial slots the current quote is pricing beyond engaged slots.
 *
 * - `first_purchase` / `new_account`: one projected slot unless the reserved entitlement
 *   already represents the purchase being quoted (same checkout / pending link).
 * - Other contexts: never project an extra slot.
 */
export function resolveProjectedPurchaseSlots(input: {
  pricingContext: CommercialPricingContext;
  reservedRepresentsQuotedPurchase?: boolean;
}): number {
  if (input.pricingContext !== "first_purchase" && input.pricingContext !== "new_account") {
    return 0;
  }
  if (input.reservedRepresentsQuotedPurchase) {
    return 0;
  }
  return 1;
}

/**
 * Canonical counters for agency display vs volume discount.
 *
 * Engaged slots = linked accounts + reserved entitlements (disjoint by model:
 * reserved rows have no `account_id` until consumed).
 *
 * Never trust client-supplied counts. Never add +1 when the reserved entitlement
 * already covers the purchase being quoted.
 */
export function resolveCommercialAccountCounts(input: {
  linkedAccountCount: number;
  reservedEntitlementCount: number;
  pricingContext: CommercialPricingContext;
  /** Plan change uses the billable count frozen on the source checkout session. */
  billableAccountCountOverride?: number | null;
  /**
   * When true, an existing reserved entitlement already represents the purchase
   * being quoted (current checkout / pending link) and must not be double-counted
   * with a projected +1.
   */
  reservedRepresentsQuotedPurchase?: boolean;
}): CommercialAccountCounts {
  const agencySnapshot = deriveAgencyModeSnapshot({
    linkedAccountCount: input.linkedAccountCount,
    reservedEntitlementCount: input.reservedEntitlementCount,
  });

  if (input.billableAccountCountOverride != null && Number.isFinite(input.billableAccountCountOverride)) {
    return {
      agencyDisplayCount: agencySnapshot.linkedAccountCount,
      linkedAccountCount: agencySnapshot.linkedAccountCount,
      reservedEntitlementCount: agencySnapshot.reservedEntitlementCount,
      billableAccountCount: Math.max(1, Math.floor(input.billableAccountCountOverride)),
      projectedPurchaseSlots: 0,
      agencyModeActive: agencySnapshot.agencyModeDisplayed,
    };
  }

  const projectedPurchaseSlots = resolveProjectedPurchaseSlots({
    pricingContext: input.pricingContext,
    reservedRepresentsQuotedPurchase: input.reservedRepresentsQuotedPurchase,
  });
  const billableAccountCount = Math.max(
    1,
    agencySnapshot.linkedAccountCount + agencySnapshot.reservedEntitlementCount + projectedPurchaseSlots,
  );

  return {
    agencyDisplayCount: agencySnapshot.linkedAccountCount,
    linkedAccountCount: agencySnapshot.linkedAccountCount,
    reservedEntitlementCount: agencySnapshot.reservedEntitlementCount,
    billableAccountCount,
    projectedPurchaseSlots,
    agencyModeActive: agencySnapshot.agencyModeDisplayed,
  };
}
