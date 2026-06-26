type SupabaseRecord = Record<string, unknown>;

export type ClientCommunicationEmailSource =
  | "clients.metadata.contact_email"
  | "clients.metadata.notification_email"
  | "clients.metadata.primary_contact_email"
  | "workspace.auth_email"
  | "missing";

export type ResolvedClientCommunicationEmail =
  | {
    ok: true;
    email: string;
    source: Exclude<ClientCommunicationEmailSource, "missing">;
  }
  | {
    ok: false;
    reason: "missing_canonical_contact";
    message: string;
  };

const FORBIDDEN_SOURCES = [
  "ig_accounts",
  "ig_account_settings",
  "account_credentials",
  "account_credentials_metadata_safe",
  "instagram_login",
  "vault",
] as const;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readMetadata(record: SupabaseRecord | null | undefined) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as SupabaseRecord;
}

export function normalizeCommunicationEmail(value: unknown) {
  const email = readString(value).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (["password", "secret", "token", "authorization", "service_role"].some((term) => email.includes(term))) {
    return null;
  }
  return email;
}

export function isForbiddenCommunicationEmailSource(source: string) {
  const normalized = source.trim().toLowerCase();
  return FORBIDDEN_SOURCES.some((entry) => normalized.includes(entry.replaceAll("_", ""))
    || normalized === entry
    || normalized.includes(entry));
}

export function resolveClientCommunicationEmail(input: {
  client?: SupabaseRecord | null;
  workspaceAuthEmail?: string | null;
}): ResolvedClientCommunicationEmail {
  const metadata = readMetadata(input.client ?? null);
  const candidates: Array<{ source: Exclude<ClientCommunicationEmailSource, "missing" | "workspace.auth_email">; value: unknown }> = [
    { source: "clients.metadata.contact_email", value: metadata?.contact_email },
    { source: "clients.metadata.notification_email", value: metadata?.notification_email },
    { source: "clients.metadata.primary_contact_email", value: metadata?.primary_contact_email },
  ];

  for (const candidate of candidates) {
    const email = normalizeCommunicationEmail(candidate.value);
    if (email) {
      return { ok: true, email, source: candidate.source };
    }
  }

  const authEmail = normalizeCommunicationEmail(input.workspaceAuthEmail);
  if (authEmail) {
    return { ok: true, email: authEmail, source: "workspace.auth_email" };
  }

  return {
    ok: false,
    reason: "missing_canonical_contact",
    message: "Canonical client communication email is not configured for this workspace.",
  };
}

export function resolveRecipientEmailSnapshot(input: {
  client?: SupabaseRecord | null;
  workspaceAuthEmail?: string | null;
}) {
  return resolveClientCommunicationEmail(input);
}

export const CONTACT_EMAIL_MISSING_LABEL = "Contact email missing";

export type ProjectedClientContactEmail = {
  display: string;
  source: ClientCommunicationEmailSource;
  available: boolean;
};

export function projectClientContactEmailDisplay(
  resolved: ResolvedClientCommunicationEmail,
): ProjectedClientContactEmail {
  if (resolved.ok) {
    return {
      display: resolved.email,
      source: resolved.source,
      available: true,
    };
  }
  return {
    display: CONTACT_EMAIL_MISSING_LABEL,
    source: "missing",
    available: false,
  };
}
