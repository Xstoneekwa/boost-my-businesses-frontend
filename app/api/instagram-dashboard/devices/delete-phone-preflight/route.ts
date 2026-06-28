import { adminDashboardConfig } from "../add-phone/route";
import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

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

export async function forwardDeletePhonePreflight(deviceId: string, config: NonNullable<ReturnType<typeof adminDashboardConfig>>) {
  const response = await fetch(config.url, {
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

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Record<string, unknown>>(request);
    const deviceId = readString(body?.device_id ?? body?.deviceId, "").trim();
    if (!deviceId) return jsonError("device_id is required.", 400);

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardDeletePhonePreflight(deviceId, config);
    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status);

    return jsonOk(forwarded.data);
  } catch {
    return jsonError("Could not load delete preflight.", 500);
  }
}
