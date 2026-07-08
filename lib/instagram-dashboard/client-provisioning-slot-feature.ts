export const CLIENT_PROVISIONING_SLOT_RESERVATIONS_ENV =
  "CLIENT_PROVISIONING_SLOT_RESERVATIONS_ENABLED" as const;

/** CP6 rollout gate — OFF by default; never grants Android access when enabled alone. */
export function clientProvisioningSlotReservationsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env[CLIENT_PROVISIONING_SLOT_RESERVATIONS_ENV] || "").trim().toLowerCase() === "true";
}
