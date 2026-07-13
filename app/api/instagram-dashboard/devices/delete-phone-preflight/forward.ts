import { readString } from "../value-readers.ts";
import type { AdminDashboardConfig } from "../admin-dashboard-config.ts";

type AdminDashboardPreflightResponse = {
  ok?: boolean;
  preflight?: Record<string, unknown>;
  error?: unknown;
};

function adminDashboardErrorMessage(error: unknown, status: number) {
  const raw = typeof error === "string"
    ? error
    : error && typeof error === "object"
      ? readString((error as Record<string, unknown>).code, readString((error as Record<string, unknown>).message, ""))
      : "";
  if (status === 401 || raw.trim().toLowerCase() === "unauthorized") {
    return "Admin dashboard API auth is not configured correctly.";
  }
  if (raw.trim().toLowerCase() === "device_not_found") return "Phone not found in inventory.";
  return raw || "Could not load delete preflight.";
}

export async function forwardDeletePhonePreflight(
  deviceId: string,
  config: AdminDashboardConfig,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(config.url, {
    method: "POST",
    headers: {
      apikey: config.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "delete_physical_phone_preflight",
      device_id: deviceId,
    }),
  });
  const payload = await response.json().catch(() => ({})) as AdminDashboardPreflightResponse;
  if (!response.ok || payload.ok !== true || !payload.preflight) {
    return {
      ok: false as const,
      message: adminDashboardErrorMessage(payload.error, response.status),
      status: response.status === 404 ? 404 : response.status === 400 ? 400 : 502,
    };
  }
  return { ok: true as const, data: payload.preflight };
}
