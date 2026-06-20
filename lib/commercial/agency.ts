import { AGENCY_DISCOUNT_TIERS } from "./catalog.ts";

export type AgencyModeSnapshot = {
  agencyModeDisplayed: boolean;
  linkedAccountCount: number;
  reservedEntitlementCount: number;
  billableAccountCount: number;
};

export function agencyDiscountPercentForBillableCount(billableAccountCount: number) {
  const count = Math.max(1, Math.floor(billableAccountCount));
  const tier = AGENCY_DISCOUNT_TIERS.find((row) => {
    if (count < row.minAccounts) return false;
    if (row.maxAccounts == null) return true;
    return count <= row.maxAccounts;
  });
  return tier?.percent ?? 0;
}

export function deriveAgencyModeSnapshot(input: {
  linkedAccountCount: number;
  reservedEntitlementCount: number;
}) {
  const linkedAccountCount = Math.max(0, input.linkedAccountCount);
  const reservedEntitlementCount = Math.max(0, input.reservedEntitlementCount);
  const billableAccountCount = linkedAccountCount + reservedEntitlementCount;
  const agencyModeDisplayed = linkedAccountCount >= 2;

  return {
    agencyModeDisplayed,
    linkedAccountCount,
    reservedEntitlementCount,
    billableAccountCount,
  } satisfies AgencyModeSnapshot;
}
