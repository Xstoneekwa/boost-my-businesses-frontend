export const COMMERCIAL_CANCEL_CONTRACT = Object.freeze({
  effective: "immediate",
  stripeCancelParams: Object.freeze({
    invoice_now: false,
    prorate: false,
  }),
  automaticRefund: false,
  nonBlockingOperationalStates: Object.freeze([
    "identity_required_unverified",
    "login_required",
    "needs_assistance",
    "operator_review",
    "open_incident",
    "insufficient_ct",
    "readiness_false",
  ]),
  hardIntegrityBlockers: Object.freeze([
    "commercial_entitlement_missing",
    "commercial_subscription_missing",
    "commercial_subscription_ambiguous",
    "lifecycle_operation_conflict",
    "runtime_still_active",
    "capacity_release_pending",
  ]),
} as const);
