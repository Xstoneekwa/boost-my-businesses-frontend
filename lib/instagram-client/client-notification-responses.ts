export function buildClientNotificationsUnavailablePatchResponse() {
  return {
    ok: false as const,
    featureAvailable: false as const,
    reason: "feature_unavailable" as const,
    error: "Client account notifications are not available yet.",
  };
}
