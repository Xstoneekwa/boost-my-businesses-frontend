export type CheckoutActivationLogEvent =
  | "checkout_public_activation_started"
  | "checkout_workspace_created"
  | "checkout_tenant_user_created"
  | "checkout_activation_completion_verified"
  | "checkout_activation_failed"
  | "checkout_activation_compensation_attempted"
  | "checkout_activation_compensation_completed"
  | "checkout_orphan_resume_started"
  | "checkout_orphan_resume_completed"
  | "checkout_orphan_resume_blocked";

export type CheckoutActivationLogInput = {
  event: CheckoutActivationLogEvent;
  idempotencyKey?: string;
  authUserId?: string | null;
  clientId?: string | null;
  stage?: string;
  reason?: string;
  postgresCode?: string;
  storageQuery?: string;
  storageMessage?: string;
  resumedOrphan?: boolean;
};

export function truncateCheckoutId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export function logCheckoutActivation(input: CheckoutActivationLogInput) {
  console.info("[commercial/checkout/activate]", {
    event: input.event,
    idempotency_key: input.idempotencyKey ?? null,
    auth_user_id: truncateCheckoutId(input.authUserId ?? null),
    client_id: truncateCheckoutId(input.clientId ?? null),
    stage: input.stage ?? null,
    reason: input.reason ?? null,
    postgres_code: input.postgresCode ?? null,
    storage_query: input.storageQuery ?? null,
    storage_message: input.storageMessage ?? null,
    resumed_orphan: input.resumedOrphan ?? null,
  });
}
