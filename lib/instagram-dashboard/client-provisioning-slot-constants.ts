export const CLIENT_PROVISIONING_SLOT_WINDOW_MINUTES = 30;
export const CLIENT_PROVISIONING_SLOT_WINDOW_MS =
  CLIENT_PROVISIONING_SLOT_WINDOW_MINUTES * 60_000;

export const CLIENT_PROVISIONING_SLOT_HORIZON_HOURS = 48;
export const CLIENT_PROVISIONING_SLOT_HORIZON_MS =
  CLIENT_PROVISIONING_SLOT_HORIZON_HOURS * 60 * 60_000;

export const CLIENT_PROVISIONING_SLOT_SCAN_STEP_MS = 5 * 60_000;

export const CLIENT_PROVISIONING_SLOT_CLIENT_TIMEZONE = "Europe/Paris";

export const CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES = [
  "reserved",
  "window_open",
  "assisted_requested",
] as const;

export type ClientProvisioningSlotReservationStatus =
  (typeof CLIENT_PROVISIONING_SLOT_ACTIVE_STATUSES)[number]
  | "consumed"
  | "expired"
  | "cancelled"
  | "invalidated";
