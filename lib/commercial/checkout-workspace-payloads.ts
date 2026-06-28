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

export function buildClientUserInsertPayload(input: { clientId: string; authUserId: string }) {
  return {
    client_id: input.clientId,
    auth_user_id: input.authUserId,
    role: CHECKOUT_CLIENT_USER_ROLE,
    status: "active",
  };
}

export function buildSimulatedCheckoutSubscriptionPayload(
  clientId: string,
  options?: { internalTestClient?: boolean },
) {
  return {
    client_id: clientId,
    subscription_type: "full_cycle",
    status: "active",
    metadata: options?.internalTestClient
      ? {
        source: "simulated_checkout",
        billing_mode: "per_account_entitlement",
        internal_test_client: true,
        billing_excluded: true,
        non_billable: true,
      }
      : {
        source: "simulated_checkout",
        billing_mode: "per_account_entitlement",
      },
  };
}
