import { CLIENT_PROVISIONING_SLOT_CLIENT_TIMEZONE } from "./client-provisioning-slot-constants.ts";

export type ClientProvisioningSlotReservationRow = {
  id: string;
  client_id: string;
  client_instagram_account_id: string;
  ig_account_id: string;
  assignment_id: string;
  device_id: string;
  app_instance_id: string;
  expected_package: string;
  window_start_utc: string;
  window_end_utc: string;
  expires_at: string;
  status: string;
  reservation_source: string;
  assisted_connect_requested_at: string | null;
  dedupe_key: string;
  safe_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function formatProvisioningSlotFranceTime(
  isoUtc: string,
  lang: "fr" | "en",
): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", {
    timeZone: CLIENT_PROVISIONING_SLOT_CLIENT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
