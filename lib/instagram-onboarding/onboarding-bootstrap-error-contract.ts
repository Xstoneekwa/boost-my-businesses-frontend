export const ONBOARDING_BOOTSTRAP_ERROR_CODES = {
  authorizationMissing: "ONBOARDING_BOOTSTRAP_AUTHORIZATION_MISSING",
  entitlementInvalid: "ENTITLEMENT_INVALID",
  entitlementAlreadyConsumed: "ENTITLEMENT_ALREADY_CONSUMED",
  packageInvalid: "PACKAGE_INVALID",
  sessionConflict: "ONBOARDING_SESSION_CONFLICT",
  idempotencyConflict: "IDEMPOTENCY_CONFLICT",
  serverError: "SERVER_ERROR",
} as const;

export type OnboardingBootstrapErrorCode =
  typeof ONBOARDING_BOOTSTRAP_ERROR_CODES[keyof typeof ONBOARDING_BOOTSTRAP_ERROR_CODES];

const AUTHORIZATION_REASONS = new Set([
  "client_access_denied", "client_not_active", "client_ownership_principal_missing",
  "onboarding_actor_access_denied", "onboarding_actor_authorization_failed",
]);
const ENTITLEMENT_INVALID_REASONS = new Set(["entitlement_required", "entitlement_not_reserved"]);
const ENTITLEMENT_CONSUMED_REASONS = new Set([
  "entitlement_already_consumed", "entitlement_consumed", "entitlement_consume_conflict",
]);
const PACKAGE_REASONS = new Set([
  "entitlement_package_invalid", "entitlement_package_mismatch", "onboarding_package_invalid",
]);
const SESSION_REASONS = new Set([
  "creation_lease_active", "terminal_session_requires_restart",
  "onboarding_actor_session_mismatch", "onboarding_not_found",
]);
const IDEMPOTENCY_REASONS = new Set([
  "idempotency_actor_mismatch", "idempotency_entitlement_mismatch", "idempotency_conflict",
]);

export function onboardingBootstrapErrorCode(reason: string): OnboardingBootstrapErrorCode {
  if (AUTHORIZATION_REASONS.has(reason)) return ONBOARDING_BOOTSTRAP_ERROR_CODES.authorizationMissing;
  if (ENTITLEMENT_INVALID_REASONS.has(reason)) return ONBOARDING_BOOTSTRAP_ERROR_CODES.entitlementInvalid;
  if (ENTITLEMENT_CONSUMED_REASONS.has(reason)) return ONBOARDING_BOOTSTRAP_ERROR_CODES.entitlementAlreadyConsumed;
  if (PACKAGE_REASONS.has(reason)) return ONBOARDING_BOOTSTRAP_ERROR_CODES.packageInvalid;
  if (SESSION_REASONS.has(reason)) return ONBOARDING_BOOTSTRAP_ERROR_CODES.sessionConflict;
  if (IDEMPOTENCY_REASONS.has(reason)) return ONBOARDING_BOOTSTRAP_ERROR_CODES.idempotencyConflict;
  return ONBOARDING_BOOTSTRAP_ERROR_CODES.serverError;
}

export function onboardingBootstrapErrorStatus(code: OnboardingBootstrapErrorCode) {
  if (code === ONBOARDING_BOOTSTRAP_ERROR_CODES.authorizationMissing) return 403;
  if (code === ONBOARDING_BOOTSTRAP_ERROR_CODES.serverError) return 500;
  return 409;
}
