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
  return 5;
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
};

export function projectClientAccountRow(input: ClientAccountProjectionInput) {
  const loginStatus = readString(input.loginStatus, "unknown");
  const onboardingStatus = readString(input.onboardingStatus, "pending");
  const provisioningStatus = readString(input.provisioningStatus, "not_started");
  const assignmentStatus = readString(input.assignmentStatus, onboardingStatus === "ready" ? "assigned" : "pending_assignment");
  const connected = loginStatus.toLowerCase() === "connected";
  let readinessLabel = "Waiting for assignment";
  if (connected) readinessLabel = "Account connected";
  else if (input.readinessStatus) readinessLabel = input.readinessStatus;
  else if (assignmentStatus.includes("pending")) readinessLabel = "Device setup pending";
  else if (provisioningStatus === "ready") readinessLabel = "Ready to connect";
  else if (loginStatus === "needs_assistance") readinessLabel = "Needs assistance";

  return {
    accountId: input.accountId,
    username: input.username,
    packageLabel: readString(input.packageLabel, "Growth"),
    accountStatus: readString(input.accountStatus, "active"),
    onboardingStatus,
    provisioningStatus,
    loginStatus,
    assignmentStatus,
    readinessLabel,
    connected,
  };
}
