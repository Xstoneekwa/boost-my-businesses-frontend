import { readString } from "../../_utils";
import { adminDashboardConfig } from "../add-phone/helpers";

type AdminDashboardDeleteResponse = {
  ok?: boolean;
  deleted?: Record<string, unknown>;
  error?: unknown;
};

export function deletePhoneStableReason(error: unknown, status: number) {
  const raw = typeof error === "string"
    ? error
    : error && typeof error === "object"
      ? readString((error as Record<string, unknown>).message, readString((error as Record<string, unknown>).code, ""))
      : "";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "device_delete_confirmation_required") return "device_delete_confirmation_required";
  if (normalized === "device_delete_confirmation_mismatch") return "device_delete_confirmation_mismatch";
  if (normalized === "device_delete_blocked_by_active_dependency") return "device_delete_blocked_by_active_dependency";
  if (normalized === "device_delete_preflight_failed") return "device_delete_preflight_failed";
  if (normalized === "device_already_retired") return "device_already_retired";
  if (status === 401 || normalized === "unauthorized") return "relay_auth_required";
  if (normalized === "device_not_found") return "device_not_found";
  return normalized || "device_delete_failed";
}

export function deletePhoneErrorMessage(error: unknown, status: number) {
  const reason = deletePhoneStableReason(error, status);
  if (reason === "device_delete_confirmation_required") return "Device delete confirmation is required.";
  if (reason === "device_delete_confirmation_mismatch") return "Device delete confirmation does not match the phone name.";
  if (reason === "device_delete_blocked_by_active_dependency") return "Phone cannot be retired while active dependencies remain.";
  if (reason === "device_delete_preflight_failed") return "Device delete preflight failed.";
  if (reason === "device_already_retired") return "Phone is already retired from operational inventory.";
  if (reason === "relay_auth_required") return "Admin dashboard API auth is not configured correctly.";
  if (reason === "device_not_found") return "Phone not found in inventory.";
  return reason || "Could not delete phone.";
}

export async function forwardDeletePhysicalPhone(
  body: Record<string, unknown>,
  config: NonNullable<ReturnType<typeof adminDashboardConfig>>,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(config.url, {
    method: "POST",
    headers: {
      apikey: config.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "delete_physical_phone",
      device_id: readString(body.device_id ?? body.deviceId, ""),
      confirmation_name: readString(body.confirmation_name ?? body.confirmationName, ""),
      source: readString(body.source, "BotApp"),
    }),
  });
  const payload = await response.json().catch(() => ({})) as AdminDashboardDeleteResponse;
  if (!response.ok || payload.ok !== true) {
    const reason = deletePhoneStableReason(payload.error, response.status);
    return {
      ok: false as const,
      reason,
      message: deletePhoneErrorMessage(payload.error, response.status),
      status: response.status === 400 || response.status === 409 ? response.status : 502,
    };
  }
  return {
    ok: true as const,
    data: {
      device_id: readString(payload.deleted?.device_id, ""),
      display_name: readString(payload.deleted?.display_name, ""),
      audit: payload.deleted && typeof payload === "object" ? (payload as Record<string, unknown>).audit : null,
    },
  };
}
