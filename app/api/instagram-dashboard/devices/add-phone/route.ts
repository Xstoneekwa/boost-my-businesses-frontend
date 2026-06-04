import { jsonError, jsonOk, readJsonBody, readNumber, readString, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

type AddPhonePayload = {
  display_name?: unknown;
  adb_serial?: unknown;
  model?: unknown;
  product?: unknown;
  device?: unknown;
  pool?: unknown;
  max_clones?: unknown;
  hub_label?: unknown;
  hub_port?: unknown;
  host_label?: unknown;
  packages_mode?: unknown;
};

type AdminDashboardAddPhoneResponse = {
  ok?: boolean;
  action?: string;
  phone?: {
    device_id?: unknown;
    adb_serial?: unknown;
    display_name?: unknown;
  };
  app_instances_created_count?: unknown;
  app_instances_existing_count?: unknown;
  warnings?: unknown;
  error?: unknown;
};

type AdminDashboardConfig = {
  url: string;
  token: string;
};

const poolValues = new Set(["full_cycle", "outreach_only"]);
const packagesMode = "standard_instagram_4_packages";
const adminDashboardTokenEnv = ["ADMIN_DASHBOARD", "INTERNAL_API_TOKEN"].join("_");
const blockedCredentialFields = [
  "pass" + "word",
  "credential",
  "credentials",
  "cookie",
  "raw_" + "secret",
  "secret" + "_ref",
  "vault" + "_payload",
  "token",
  "api_key",
  "service" + "_role",
];

function normalizeLabel(value: unknown, maxLength: number) {
  return readString(value, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hasBlockedCredentialField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasBlockedCredentialField);

  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.trim().toLowerCase();
    return blockedCredentialFields.some((field) => normalized.includes(field)) ||
      hasBlockedCredentialField(child);
  });
}

function normalizeMaxClones(value: unknown) {
  const raw = value == null || value === "" ? 3 : readNumber(value, 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(3, Math.min(16, Math.trunc(raw)));
}

function optionalString(value: unknown, maxLength: number) {
  const normalized = normalizeLabel(value, maxLength);
  return normalized || null;
}

export function addPhoneValidationError(body: Record<string, unknown> | null) {
  if (!body) return "Invalid phone payload.";
  if (hasBlockedCredentialField(body)) return "Credentials and secrets are not accepted by this form.";

  const displayName = normalizeLabel(body.display_name, 80);
  if (displayName.length < 2) return "Display name is required.";

  const adbSerial = normalizeLabel(body.adb_serial, 120);
  if (!adbSerial) return "ADB serial is required.";

  const pool = normalizeLabel(body.pool, 32);
  if (!poolValues.has(pool)) return "invalid_pool";

  const requestedPackagesMode = normalizeLabel(body.packages_mode, 64) || packagesMode;
  if (requestedPackagesMode !== packagesMode) return "Unsupported packages mode.";

  return null;
}

export function addPhysicalPhonePayload(body: AddPhonePayload) {
  return {
    action: "add_physical_phone",
    display_name: normalizeLabel(body.display_name, 80),
    adb_serial: normalizeLabel(body.adb_serial, 120),
    model: optionalString(body.model, 80),
    product: optionalString(body.product, 80),
    device: optionalString(body.device, 80),
    pool: normalizeLabel(body.pool, 32),
    max_clones: normalizeMaxClones(body.max_clones),
    hub_label: optionalString(body.hub_label, 80),
    hub_port: optionalString(body.hub_port, 80),
    host_label: optionalString(body.host_label, 80),
    packages_mode: packagesMode,
  };
}

export function adminDashboardConfig(env: NodeJS.ProcessEnv = process.env): AdminDashboardConfig | null {
  const explicitUrl = env.ADMIN_DASHBOARD_API_URL?.trim();
  const baseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const url = explicitUrl || (baseUrl ? `${baseUrl}/functions/v1/admin-dashboard` : "");
  const token = env[adminDashboardTokenEnv]?.trim();

  if (!url || !token) return null;
  return { url, token };
}

function adminDashboardErrorMessage(error: unknown, status: number) {
  const raw = typeof error === "string"
    ? error
    : error && typeof error === "object"
      ? readString((error as Record<string, unknown>).code, readString((error as Record<string, unknown>).message, ""))
      : "";
  const normalized = raw.trim().toLowerCase();

  if (status === 401 || normalized === "unauthorized") return "Admin dashboard API auth is not configured correctly.";
  if (normalized.includes("duplicate_adb_serial")) return "ADB serial is duplicated in phone inventory.";
  if (normalized.includes("app_instance_occupied")) return "A matching app instance is occupied and cannot be overwritten.";
  if (normalized.includes("app_instance_index_conflict")) return "Existing app instance index conflicts with the standard package map.";
  if (normalized.includes("app_instance_package_conflict")) return "Existing app package conflicts with the standard package map.";
  if (normalized.includes("invalid_pool")) return "Pool must be full_cycle or outreach_only.";
  if (normalized.includes("credential") || normalized.includes("secret")) return "Credentials and secrets are not accepted by this form.";
  if (raw) return raw;
  return "Could not add phone.";
}

export function safeAddPhoneResponse(payload: AdminDashboardAddPhoneResponse) {
  const phone = payload.phone || {};
  return {
    device_id: readString(phone.device_id, ""),
    display_name: readString(phone.display_name, ""),
    adb_serial: readString(phone.adb_serial, ""),
    app_instances_created_count: Math.max(0, Math.trunc(readNumber(payload.app_instances_created_count, 0))),
    app_instances_existing_count: Math.max(0, Math.trunc(readNumber(payload.app_instances_existing_count, 0))),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map((warning) => readString(warning, "")).filter(Boolean) : [],
  };
}

export async function forwardAddPhysicalPhoneToAdminDashboard(
  body: AddPhonePayload,
  config: AdminDashboardConfig,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(config.url, {
    method: "POST",
    headers: {
      apikey: config.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(addPhysicalPhonePayload(body)),
  });
  const payload = await response.json().catch(() => ({})) as AdminDashboardAddPhoneResponse;

  if (!response.ok || payload.ok !== true) {
    return {
      ok: false as const,
      message: adminDashboardErrorMessage(payload.error, response.status),
      status: response.status === 400 || response.status === 409 ? response.status : 502,
    };
  }

  return { ok: true as const, data: safeAddPhoneResponse(payload) };
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<Record<string, unknown>>(request);
    const validationError = addPhoneValidationError(body);
    if (validationError) return jsonError(validationError, 400);

    const config = adminDashboardConfig();
    if (!config) return jsonError("Admin dashboard API config is missing.", 500);

    const forwarded = await forwardAddPhysicalPhoneToAdminDashboard(body as AddPhonePayload, config);
    if (!forwarded.ok) return jsonError(forwarded.message, forwarded.status);

    return jsonOk(forwarded.data, 201);
  } catch {
    return jsonError("Could not add phone.", 500);
  }
}
