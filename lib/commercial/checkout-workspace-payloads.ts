import type { CommercialCheckoutProvenance } from "./commercial-provenance.ts";

/** Matches tenant_users DB check: role in ('tenant', 'superadmin'). Instagram clients use tenant. */
export const CHECKOUT_TENANT_USER_ROLE = "tenant" as const;

export const CHECKOUT_CLIENT_USER_ROLE = "owner" as const;

export function buildTenantUserInsertPayload(input: { authUserId: string; clientId: string }) {
  return {
    user_id: input.authUserId,
    tenant_id: input.clientId,
    role: CHECKOUT_TENANT_USER_ROLE,
  };
}

export function buildClientUserInsertPayload(input: { authUserId: string; clientId: string }) {
  return {
    client_id: input.clientId,
    auth_user_id: input.authUserId,
    role: CHECKOUT_CLIENT_USER_ROLE,
    status: "active",
  };
}

export function buildCheckoutSubscriptionPayload(
  clientId: string,
  options?: {
    provenance?: CommercialCheckoutProvenance;
    internalTestClient?: boolean;
  },
) {
  const source = options?.provenance ?? "simulated_checkout";
  return {
    client_id: clientId,
    subscription_type: "full_cycle",
    status: "active",
    metadata: options?.internalTestClient
      ? {
        source,
        billing_mode: "per_account_entitlement",
        internal_test_client: true,
        billing_excluded: true,
        non_billable: true,
      }
      : {
        source,
        billing_mode: "per_account_entitlement",
      },
  };
}

/** @deprecated Use buildCheckoutSubscriptionPayload with explicit provenance. */
export function buildSimulatedCheckoutSubscriptionPayload(
  clientId: string,
  options?: { internalTestClient?: boolean },
) {
  return buildCheckoutSubscriptionPayload(clientId, {
    provenance: "simulated_checkout",
    internalTestClient: options?.internalTestClient,
  });
}
