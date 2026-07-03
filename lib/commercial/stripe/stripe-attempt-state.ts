export const STRIPE_ATTEMPT_STATUS = {
  SESSION_CREATED: "session_created",
  AWAITING_PAYMENT: "awaiting_payment",
  PAYMENT_CONFIRMED: "payment_confirmed",
  FULFILLMENT_PROCESSING: "fulfillment_processing",
  FULFILLED: "fulfilled",
  RECONCILIATION_REQUIRED: "reconciliation_required",
  FAILED_RECOVERABLE: "failed_recoverable",
  EXPIRED: "expired",
  FAILED: "failed",
  CANCELLED: "cancelled",
  COMPLETED_LEGACY: "completed",
} as const;

export type StripeAttemptStatus = typeof STRIPE_ATTEMPT_STATUS[keyof typeof STRIPE_ATTEMPT_STATUS];

export function isStripeAttemptFulfilled(status: string) {
  return status === STRIPE_ATTEMPT_STATUS.FULFILLED || status === STRIPE_ATTEMPT_STATUS.COMPLETED_LEGACY;
}

export function isStripeAttemptRecoverable(status: string) {
  return status === STRIPE_ATTEMPT_STATUS.PAYMENT_CONFIRMED
    || status === STRIPE_ATTEMPT_STATUS.FULFILLMENT_PROCESSING
    || status === STRIPE_ATTEMPT_STATUS.RECONCILIATION_REQUIRED
    || status === STRIPE_ATTEMPT_STATUS.FAILED_RECOVERABLE;
}

export function mapAttemptStatusToCommercialStatus(status: string) {
  if (isStripeAttemptFulfilled(status)) {
    return "checkout_paid";
  }
  if (status === STRIPE_ATTEMPT_STATUS.AWAITING_PAYMENT) {
    return "checkout_pending_payment";
  }
  if (isStripeAttemptRecoverable(status)) {
    return "checkout_paid_pending_fulfillment";
  }
  if (status === STRIPE_ATTEMPT_STATUS.SESSION_CREATED) {
    return "checkout_pending_payment";
  }
  if (status === STRIPE_ATTEMPT_STATUS.EXPIRED) {
    return "checkout_expired";
  }
  return "checkout_pending_payment";
}
