export type CredentialBusinessStatus =
  | "active"
  | "saved_pending_verification"
  | "missing"
  | "needs_update"
  | "unknown";

export type CredentialStatusProjectionInput = {
  credentialsConfigured?: boolean | null;
  credentialsStatus?: string | null;
  reauthRequired?: boolean | null;
  secretRefPresent?: boolean | null;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function normalize(value: unknown) {
  return readString(value).toLowerCase();
}

function looksSaved(value: string) {
  return value === "active" || value === "configured" || value === "saved_pending_verification";
}

export function projectCredentialBusinessStatus(input: CredentialStatusProjectionInput): CredentialBusinessStatus {
  const rawStatus = normalize(input.credentialsStatus);
  const hasConfiguredFlag = input.credentialsConfigured === true;
  const hasSecretRef = input.secretRefPresent !== false;
  const saved = hasSecretRef && (hasConfiguredFlag || looksSaved(rawStatus));

  if (rawStatus.includes("missing") || input.credentialsConfigured === false) return "missing";
  if (rawStatus.includes("invalid") || rawStatus.includes("failed") || rawStatus.includes("password_invalid") || rawStatus.includes("needs_update")) return "needs_update";
  if (saved && input.reauthRequired === true) return "saved_pending_verification";
  if (rawStatus.includes("reauth")) return saved ? "saved_pending_verification" : "needs_update";
  if (saved) return "active";
  return rawStatus ? "unknown" : "missing";
}

export function credentialStatusLabel(status: CredentialBusinessStatus) {
  if (status === "saved_pending_verification") return "credentials saved - login pending";
  if (status === "active") return "credentials saved";
  if (status === "missing") return "missing credentials";
  if (status === "needs_update") return "credentials invalid";
  return "credentials unknown";
}

export function credentialNextActionLabel(status: CredentialBusinessStatus) {
  if (status === "saved_pending_verification") return "Run Auto Login / verify login";
  if (status === "active") return "None";
  if (status === "missing") return "Add credentials";
  if (status === "needs_update") return "Update password";
  return "Review account";
}
