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
  /** Linked + reserved (+1 only for new_account / first_purchase quotes). */
  billableAccountCount: number;
  agencyModeActive: boolean;
};

/**
 * Canonical counters for agency display vs volume discount.
 *
 * Billable = linked accounts (each represents an engaged IG slot) plus reserved
 * entitlements (paid, not yet linked). Never trust client-supplied counts.
 */
export function resolveCommercialAccountCounts(input: {
  linkedAccountCount: number;
  reservedEntitlementCount: number;
  pricingContext: CommercialPricingContext;
  /** Plan change uses the billable count frozen on the source checkout session. */
  billableAccountCountOverride?: number | null;
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
      agencyModeActive: agencySnapshot.agencyModeDisplayed,
    };
  }

  let billableAccountCount = agencySnapshot.billableAccountCount;
  if (input.pricingContext === "first_purchase" || input.pricingContext === "new_account") {
    billableAccountCount = Math.max(1, billableAccountCount + 1);
  } else {
    billableAccountCount = Math.max(1, billableAccountCount);
  }

  return {
    agencyDisplayCount: agencySnapshot.linkedAccountCount,
    linkedAccountCount: agencySnapshot.linkedAccountCount,
    reservedEntitlementCount: agencySnapshot.reservedEntitlementCount,
    billableAccountCount,
    agencyModeActive: agencySnapshot.agencyModeDisplayed,
  };
}
