import { adminDashboardConfig } from "../add-phone/route";
import { jsonError, jsonOk, readJsonBody, readString, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

type AdminDashboardDeleteResponse = {
  ok?: boolean;
  deleted?: Record<string, unknown>;
  error?: unknown;
};

function adminDashboardErrorMessage(error: unknown, status: number) {
  const raw = typeof error === "string"
    ? error
    : error && typeof error === "object"
      ? readString((error as Record<string, unknown>).code, readString((error as Record<string, unknown>).message, ""))
      : "";
  const normalized = raw.trim().toLowerCase();
  if (status === 401 || normalized === "unauthorized") {
    return "Admin dashboard API auth is not configured correctly.";
  }
  if (normalized === "confirmation_name_mismatch") {
    return "Confirmation name does not match the phone display name.";
  }
  if (normalized === "device_delete_blocked") {
    return "Phone cannot be deleted while dependencies remain.";
  }
  if (normalized === "device_not_found") return "Phone not found in inventory.";
  return raw || "Could not delete phone.";
}

export async function forwardDeletePhysicalPhone(
  body: Record<string, unknown>,
  config: NonNullable<ReturnType<typeof adminDashboardConfig>>,
) {
  const response = await fetch(config.url, {
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
    return {
      ok: false as const,
      message: adminDashboardErrorMessage(payload.error, response.status),
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

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Delete phone");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Record<string, unknown>>(request);
    const deviceId = readString(body?.device_id ?? body?.deviceId, "").trim();
    const confirmationName = readString(body?.confirmation_name ?? body?.confirmationName, "").trim();
    if (!deviceId) return jsonError("device_id is required.", 400);
    if (!confirmationName) return jsonError("confirmation_name is required.", 400);

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardDeletePhysicalPhone(body || {}, config);
    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status);

    return jsonOk(forwarded.data);
  } catch {
    return jsonError("Could not delete phone.", 500);
  }
}
