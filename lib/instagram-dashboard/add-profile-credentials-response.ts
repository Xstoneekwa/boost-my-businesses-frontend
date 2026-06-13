export type AddProfileCredentialsPayload = {
  credentials_status?: string | null;
  status?: string | null;
  reauth_required?: boolean | null;
  secret_ref_present?: boolean | null;
};

export type AddProfileCredentialsResolution = {
  credentials_configured: boolean;
  credential_status: "active" | "saved_pending_verification" | "missing" | "failed" | "not_submitted";
  credential_save_status: "saved" | "not_provided" | "failed";
};

const savedCredentialStatuses = new Set(["active", "saved_pending_verification"]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function normalizeStatus(value: unknown) {
  return readString(value).toLowerCase();
}

export function isAddProfileCredentialsSaved(
  credentials: AddProfileCredentialsPayload | null | undefined,
) {
  if (!credentials) return false;
  if (credentials.secret_ref_present === false) return false;
  const rowStatus = normalizeStatus(credentials.status);
  const credentialsStatus = normalizeStatus(credentials.credentials_status);
  if (rowStatus !== "active") return false;
  if (savedCredentialStatuses.has(credentialsStatus)) return true;
  return credentials.reauth_required === true;
}

export function resolveAddProfileCredentialStatus(
  credentials: AddProfileCredentialsPayload | null | undefined,
): AddProfileCredentialsResolution["credential_status"] {
  if (!credentials) return "not_submitted";
  if (!isAddProfileCredentialsSaved(credentials)) return "failed";
  if (credentials.reauth_required === true) return "saved_pending_verification";
  const credentialsStatus = normalizeStatus(credentials.credentials_status);
  if (credentialsStatus === "saved_pending_verification") return "saved_pending_verification";
  return "active";
}

export function resolveAddProfileCredentialsResponse(input: {
  credentials?: AddProfileCredentialsPayload | null;
  credentialsSubmitted?: boolean;
}): AddProfileCredentialsResolution {
  const credentialsSubmitted = input.credentialsSubmitted === true;
  if (!credentialsSubmitted) {
    return {
      credentials_configured: false,
      credential_status: "not_submitted",
      credential_save_status: "not_provided",
    };
  }

  const credentials = input.credentials ?? null;
  const credentialsConfigured = isAddProfileCredentialsSaved(credentials);
  return {
    credentials_configured: credentialsConfigured,
    credential_status: resolveAddProfileCredentialStatus(credentials),
    credential_save_status: credentialsConfigured ? "saved" : "failed",
  };
}
