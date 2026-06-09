export type DashboardRunEligibility = {
  ok_to_start: boolean;
  reason: string;
  message: string;
};

const assignNowReasons = new Set([
  "assignment_missing",
  "assignment_window_closed",
  "needs_phone_assignment",
  "waiting_scheduled_assignment",
  "no_app_instance_available",
  "device_unavailable",
]);

export function resolveActionButtonDisabled(disabled?: boolean | null) {
  return disabled === true;
}

export function buildConnectButtonDisabledState(input: {
  isConnectingNow: boolean;
  isStartingRun: boolean;
  isCheckingReadiness: boolean;
  eligibilityLoading: boolean;
  eligibilityError: string;
  eligibility: DashboardRunEligibility | null;
}) {
  const eligibilityPending = isRunEligibilityPending(input.eligibilityLoading, input.eligibility);
  const disabled = resolveActionButtonDisabled(
    input.isConnectingNow
      || input.isStartingRun
      || input.isCheckingReadiness
      || eligibilityPending
      || Boolean(input.eligibilityError),
  );
  const disabledReason = input.isConnectingNow
    ? "Connecting..."
    : input.isStartingRun
      ? "A manual run is starting."
      : input.isCheckingReadiness
        ? "Checking readiness..."
        : eligibilityPending
          ? "Checking run eligibility..."
          : input.eligibilityError
            ? "Unable to verify connection eligibility."
            : undefined;

  return { disabled, disabledReason, eligibilityPending };
}

export function isRunEligibilityPending(
  loading: boolean,
  eligibility: DashboardRunEligibility | null,
  hasHydrated = true,
) {
  if (!hasHydrated) return true;
  return loading || eligibility === null;
}

export function isPlayDisabled(
  isStartingRun: boolean,
  eligibilityPending: boolean,
  eligibilityError: string,
  eligibility: DashboardRunEligibility | null,
) {
  return isStartingRun || eligibilityPending || Boolean(eligibilityError) || eligibility?.ok_to_start !== true;
}

export function shouldShowAssignNow(eligibility: DashboardRunEligibility | null) {
  if (!eligibility || eligibility.ok_to_start !== false) return false;
  return assignNowReasons.has(eligibility.reason);
}

export function shouldShowCredentialsConfirm(eligibility: DashboardRunEligibility | null) {
  if (!eligibility || eligibility.ok_to_start !== false) return false;
  return eligibility.reason === "reauth_required" || eligibility.reason === "credentials_reauth_required";
}

export function shouldShowConnect(eligibility: DashboardRunEligibility | null) {
  if (!eligibility || eligibility.ok_to_start !== false) return false;
  return eligibility.reason === "login_not_connected" || eligibility.reason === "login_verification_required";
}
