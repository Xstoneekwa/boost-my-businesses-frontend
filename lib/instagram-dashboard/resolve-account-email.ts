type SupabaseRecord = Record<string, unknown>;

export type AccountEmailSource =
  | "ig_accounts"
  | "ig_account_settings"
  | "account_credentials_metadata_safe"
  | "admin_dashboard"
  | "unknown";

export type ResolvedAccountEmail = {
  email: string;
  emailDisplay: string;
  emailSource: AccountEmailSource;
  emailAvailable: boolean;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readRecord(value: unknown): SupabaseRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SupabaseRecord;
}

export function normalizeSafeEmail(value: unknown) {
  const email = readString(value);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (["password", "secret", "token", "authorization", "service_role"].some((term) => email.toLowerCase().includes(term))) {
    return null;
  }
  return email;
}

export function resolveAccountEmail(input: {
  igAccount?: SupabaseRecord | null;
  accountSettings?: SupabaseRecord | null;
  credentialMetadataSafe?: SupabaseRecord | null;
  adminProjection?: SupabaseRecord | null;
}): ResolvedAccountEmail {
  const candidates: Array<{ source: AccountEmailSource; value: unknown }> = [
    { source: "ig_accounts", value: input.igAccount?.email },
    { source: "ig_account_settings", value: input.accountSettings?.email },
    { source: "account_credentials_metadata_safe", value: input.credentialMetadataSafe?.email ?? input.credentialMetadataSafe?.account_email ?? input.credentialMetadataSafe?.login_email },
    { source: "admin_dashboard", value: input.adminProjection?.email_display ?? input.adminProjection?.email },
  ];

  for (const candidate of candidates) {
    const email = normalizeSafeEmail(candidate.value);
    if (email) {
      return {
        email,
        emailDisplay: email,
        emailSource: candidate.source,
        emailAvailable: true,
      };
    }
  }

  return {
    email: "unknown",
    emailDisplay: "unknown",
    emailSource: "unknown",
    emailAvailable: false,
  };
}

export function mergeResolvedAccountEmail(
  current: {
    emailDisplay: string;
    emailSource?: string | null;
    emailAvailable?: boolean;
  } | null | undefined,
  resolved: ResolvedAccountEmail,
): ResolvedAccountEmail {
  if (current?.emailAvailable && current.emailDisplay !== "unknown") {
    return {
      email: current.emailDisplay,
      emailDisplay: current.emailDisplay,
      emailSource: (current.emailSource as AccountEmailSource) || resolved.emailSource,
      emailAvailable: true,
    };
  }
  return resolved;
}

export function resolvedEmailFromRow(row: SupabaseRecord | undefined, source: AccountEmailSource = "ig_accounts") {
  const explicitDisplay = readString(row?.email_display);
  if (explicitDisplay && explicitDisplay !== "unknown") {
    const email = normalizeSafeEmail(explicitDisplay);
    if (email) {
      return {
        email,
        emailDisplay: email,
        emailSource: source === "ig_accounts" ? "admin_dashboard" : source,
        emailAvailable: true,
      } satisfies ResolvedAccountEmail;
    }
  }

  return resolveAccountEmail({
    igAccount: source === "ig_accounts" ? row : null,
    adminProjection: source === "admin_dashboard" ? row : null,
  });
}
