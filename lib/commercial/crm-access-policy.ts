export const COMMERCIAL_CRM_ACCESS_PERMISSION = "commercial_crm_access" as const;

export type CommercialCrmAccessInput = {
  authenticated: boolean;
  role: string | null;
  grantLookupSucceeded: boolean;
  hasActiveGrant: boolean;
};

export type CommercialCrmAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: 401 | 403 | 503;
      code:
        | "commercial_crm_authentication_required"
        | "commercial_crm_superadmin_required"
        | "commercial_crm_access_grant_required"
        | "commercial_crm_access_check_unavailable";
    };

export function evaluateCommercialCrmAccess(input: CommercialCrmAccessInput): CommercialCrmAccessDecision {
  if (!input.authenticated) {
    return { allowed: false, status: 401, code: "commercial_crm_authentication_required" };
  }

  if (input.role !== "superadmin") {
    return { allowed: false, status: 403, code: "commercial_crm_superadmin_required" };
  }

  if (!input.grantLookupSucceeded) {
    return { allowed: false, status: 503, code: "commercial_crm_access_check_unavailable" };
  }

  if (!input.hasActiveGrant) {
    return { allowed: false, status: 403, code: "commercial_crm_access_grant_required" };
  }

  return { allowed: true };
}
