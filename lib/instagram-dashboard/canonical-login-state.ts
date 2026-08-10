export type CanonicalLoginStateInput = {
  loginStatus?: unknown;
  loginIdentityProofStatus?: unknown;
  loginIdentityProfileOpened?: unknown;
  loginIdentityUsernameMatch?: unknown;
  loginIdentityVerifiedAt?: unknown;
  loginStateInvalidationReason?: unknown;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function hasCanonicalVerifiedLoginIdentity(input: CanonicalLoginStateInput): boolean {
  return normalize(input.loginIdentityProofStatus) === "verified"
    && input.loginIdentityProfileOpened === true
    && input.loginIdentityUsernameMatch === true
    && Boolean(String(input.loginIdentityVerifiedAt ?? "").trim());
}

export function hasNonBlockingHistoricalLoginIdentity(input: CanonicalLoginStateInput): boolean {
  return normalize(input.loginIdentityProofStatus) === "historical_model_missing"
    && !normalize(input.loginStateInvalidationReason);
}

export function projectCanonicalLoginStatus(input: CanonicalLoginStateInput): string {
  const raw = normalize(input.loginStatus) || "unknown";
  if (raw !== "connected") return raw;
  return hasCanonicalVerifiedLoginIdentity(input) || hasNonBlockingHistoricalLoginIdentity(input)
    ? "connected"
    : "verification_pending";
}
