export type LivePhoneInventorySummary = {
  total_phone_devices: number;
  physical_phone_count: number;
  emulator_count: number;
  available_phone_count: number;
  unavailable_phone_count: number;
  total_app_instances: number;
  available_app_instances: number;
  occupied_app_instances: number;
  problem_phone_count: number;
  adb_status_unknown_count: number;
};

export type LivePhoneAppInstance = {
  app_instance_id: string;
  instance_index: number | null;
  instance_kind: string;
  app_role: string;
  package_name: string;
  status: string;
  current_account_id: string | null;
  adb_package_verified: boolean | null;
};

export type LivePhoneDevice = {
  device_id: string;
  display_name: string;
  adb_serial: string;
  device_kind: string;
  kind: string;
  status: string;
  pool: string;
  max_clones: number | null;
  model: string | null;
  product: string | null;
  device: string | null;
  hub_label: string | null;
  hub_port: string | null;
  host_label: string | null;
  heartbeat_status: string;
  heartbeat_last_seen_at: string | null;
  app_instances_count: number;
  app_instances_available_count: number;
  app_instances_occupied_count: number;
  issues: string[];
  app_instances: LivePhoneAppInstance[];
};

export type LiveDevicesOverview = {
  ok: true;
  action: "devices_overview";
  count: number;
  phone_devices: LivePhoneDevice[];
  items: LivePhoneDevice[];
  phone_inventory_summary: LivePhoneInventorySummary;
};

type AdminDashboardConfig = {
  url: string;
  token: string;
};

const adminDashboardTokenEnv = ["ADMIN_DASHBOARD", "INTERNAL_API_TOKEN"].join("_");
const adminDashboardTimeoutMs = 12_000;
const defaultSummary: LivePhoneInventorySummary = {
  total_phone_devices: 0,
  physical_phone_count: 0,
  emulator_count: 0,
  available_phone_count: 0,
  unavailable_phone_count: 0,
  total_app_instances: 0,
  available_app_instances: 0,
  occupied_app_instances: 0,
  problem_phone_count: 0,
  adb_status_unknown_count: 0,
};
const allowedIssues = new Set([
  "adb_status_unknown",
  "stale_heartbeat",
  "missing_primary_instance",
  "missing_standard_clone_package",
  "occupied_instance_on_unavailable_device",
  "duplicate_adb_serial",
  "no_app_instances",
]);

export function devicesOverviewPayload() {
  return { action: "devices_overview" as const };
}

export function adminDashboardConfig(env: NodeJS.ProcessEnv = process.env): AdminDashboardConfig | null {
  const explicitUrl = env.ADMIN_DASHBOARD_API_URL?.trim();
  const baseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const url = explicitUrl || (baseUrl ? `${baseUrl}/functions/v1/admin-dashboard` : "");
  const token = env[adminDashboardTokenEnv]?.trim();

  if (!url || !token) return null;
  return { url, token };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readNullableString(row: Record<string, unknown>, key: string) {
  const value = readString(row, key, "").trim();
  return value || null;
}

function readNumber(row: Record<string, unknown>, key: string, fallback = 0) {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readNonNegativeInteger(row: Record<string, unknown>, key: string) {
  return Math.max(0, Math.trunc(readNumber(row, key, 0)));
}

function readNullableInteger(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (value == null || value === "") return null;
  const parsed = readNumber(row, key, Number.NaN);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function readBooleanOrNull(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value === "boolean") return value;
  return null;
}

function readIssueList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((issue) => typeof issue === "string" ? issue.trim() : "")
    .filter((issue) => allowedIssues.has(issue));
}

function safeSummary(value: unknown): LivePhoneInventorySummary {
  const row = asRecord(value);
  return {
    total_phone_devices: readNonNegativeInteger(row, "total_phone_devices"),
    physical_phone_count: readNonNegativeInteger(row, "physical_phone_count"),
    emulator_count: readNonNegativeInteger(row, "emulator_count"),
    available_phone_count: readNonNegativeInteger(row, "available_phone_count"),
    unavailable_phone_count: readNonNegativeInteger(row, "unavailable_phone_count"),
    total_app_instances: readNonNegativeInteger(row, "total_app_instances"),
    available_app_instances: readNonNegativeInteger(row, "available_app_instances"),
    occupied_app_instances: readNonNegativeInteger(row, "occupied_app_instances"),
    problem_phone_count: readNonNegativeInteger(row, "problem_phone_count"),
    adb_status_unknown_count: readNonNegativeInteger(row, "adb_status_unknown_count"),
  };
}

function safeAppInstance(value: unknown): LivePhoneAppInstance {
  const row = asRecord(value);
  return {
    app_instance_id: readString(row, "app_instance_id"),
    instance_index: readNullableInteger(row, "instance_index"),
    instance_kind: readString(row, "instance_kind", readString(row, "app_role", "unknown")),
    app_role: readString(row, "app_role", readString(row, "instance_kind", "unknown")),
    package_name: readString(row, "package_name"),
    status: readString(row, "status", "unknown"),
    current_account_id: readNullableString(row, "current_account_id"),
    adb_package_verified: readBooleanOrNull(row, "adb_package_verified"),
  };
}

function safePhone(value: unknown): LivePhoneDevice {
  const row = asRecord(value);
  const appInstances = Array.isArray(row.app_instances) ? row.app_instances.map(safeAppInstance) : [];
  const deviceKind = readString(row, "device_kind", readString(row, "kind", "unknown"));

  return {
    device_id: readString(row, "device_id"),
    display_name: readString(row, "display_name", readString(row, "name", "Unnamed phone")),
    adb_serial: readString(row, "adb_serial"),
    device_kind: deviceKind,
    kind: readString(row, "kind", deviceKind),
    status: readString(row, "status", "unknown"),
    pool: readString(row, "pool", "unknown"),
    max_clones: readNullableInteger(row, "max_clones"),
    model: readNullableString(row, "model"),
    product: readNullableString(row, "product"),
    device: readNullableString(row, "device"),
    hub_label: readNullableString(row, "hub_label"),
    hub_port: readNullableString(row, "hub_port"),
    host_label: readNullableString(row, "host_label"),
    heartbeat_status: readString(row, "heartbeat_status", "unknown"),
    heartbeat_last_seen_at: readNullableString(row, "heartbeat_last_seen_at"),
    app_instances_count: readNonNegativeInteger(row, "app_instances_count"),
    app_instances_available_count: readNonNegativeInteger(row, "app_instances_available_count"),
    app_instances_occupied_count: readNonNegativeInteger(row, "app_instances_occupied_count"),
    issues: readIssueList(row.issues),
    app_instances: appInstances.sort((a, b) => (a.instance_index ?? 999) - (b.instance_index ?? 999)),
  };
}

export function safeDevicesOverviewResponse(payload: unknown): LiveDevicesOverview {
  const row = asRecord(payload);
  const phoneDevices = Array.isArray(row.phone_devices) ? row.phone_devices.map(safePhone) : [];
  const rawItems = Array.isArray(row.items) ? row.items.map(safePhone) : phoneDevices;
  const items = rawItems.length ? rawItems : phoneDevices;

  return {
    ok: true,
    action: "devices_overview",
    count: readNonNegativeInteger(row, "count") || phoneDevices.length || items.length,
    phone_devices: phoneDevices,
    items,
    phone_inventory_summary: safeSummary(row.phone_inventory_summary ?? defaultSummary),
  };
}

export async function forwardDevicesOverviewToAdminDashboard(
  config: AdminDashboardConfig,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(config.url, {
    method: "POST",
    headers: {
      apikey: config.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(devicesOverviewPayload()),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

  if (!response.ok || payload.ok !== true || payload.action !== "devices_overview") {
    return {
      ok: false as const,
      message: response.status === 401 ? "Admin dashboard API auth is not configured correctly." : "Could not load live device inventory.",
      status: response.status === 401 ? 502 : 502,
    };
  }

  return { ok: true as const, data: safeDevicesOverviewResponse(payload) };
}

export async function getLiveDevicesOverviewData(): Promise<LiveDevicesOverview & { errors: string[] }> {
  const config = adminDashboardConfig();
  if (!config) {
    return { ...safeDevicesOverviewResponse({}), errors: ["Admin dashboard API config is missing."] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), adminDashboardTimeoutMs);

  try {
    const result = await forwardDevicesOverviewToAdminDashboard(config, (url, init) => fetch(url, { ...init, signal: controller.signal }));
    if (!result.ok) {
      return { ...safeDevicesOverviewResponse({}), errors: [result.message] };
    }
    return { ...result.data, errors: [] };
  } catch {
    return { ...safeDevicesOverviewResponse({}), errors: ["Could not load live device inventory."] };
  } finally {
    clearTimeout(timeout);
  }
}
