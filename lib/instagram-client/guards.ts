export function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

export function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = readString(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

const TECHNICAL_FIELD_KEYS = [
  "device_id",
  "phone_device_id",
  "phone_id",
  "app_instance_id",
  "clone_index",
  "adb_serial",
  "package_name",
  "device_udid",
  "device_name",
  "clone_mode",
  "schedule_mode",
  "starts_at",
  "ends_at",
  "template_id",
  "template_mode",
  "runtime_mode",
  "commercial_package",
  "addons",
  "provisioning_enabled",
  "login_enabled",
  "start_run",
  "package",
  "plan",
  "subscription_id",
  "role",
  "tenant_id",
  "client_id",
  "account_id",
  "assignment",
  "payment_method",
  "invoice",
] as const;

export function rejectTechnicalClientFields(body: Record<string, unknown> | null | undefined) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of TECHNICAL_FIELD_KEYS) {
    if (key in body && body[key] != null && readString(body[key]) !== "") {
      return "Technical assignment fields are not allowed for client add account.";
    }
  }
  return null;
}

export function clientMaxAccountsLimit() {
  const fromEnv = Number(process.env.INSTAGRAM_CLIENT_MAX_ACCOUNTS ?? "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return Number.POSITIVE_INFINITY;
}

export type ClientAccountProjectionInput = {
  accountId: string;
  username: string;
  packageLabel?: string;
  accountStatus?: string;
  onboardingStatus?: string;
  provisioningStatus?: string;
  loginStatus?: string;
  assignmentStatus?: string;
  readinessStatus?: string;
  activeConnectStatus?: string | null;
  operationPending?: boolean;
};

export function projectClientAccountRow(input: ClientAccountProjectionInput) {
  const loginStatus = readString(input.loginStatus, "unknown");
  const onboardingStatus = readString(input.onboardingStatus, "pending");
  const provisioningStatus = readString(input.provisioningStatus, "not_started");
  const assignmentStatus = readString(input.assignmentStatus, onboardingStatus === "ready" ? "assigned" : "pending_assignment");
  const connected = loginStatus.toLowerCase() === "connected";

  const clientReadinessStatus = readString(input.readinessStatus, "");
  const activeConnectStatus = readString(input.activeConnectStatus, "") || null;

  return {
    accountId: input.accountId,
    username: input.username,
    packageLabel: readString(input.packageLabel, "Growth"),
    accountStatus: readString(input.accountStatus, "active"),
    onboardingStatus,
    provisioningStatus,
    loginStatus,
    assignmentStatus,
    readinessLabel: "",
    connected,
    ...(clientReadinessStatus ? { clientReadinessStatus } : {}),
    ...(activeConnectStatus ? { activeConnectStatus } : {}),
    ...(input.operationPending ? { operationPending: true } : {}),
  };
}
