type QueryResult = { data?: unknown; error?: { message?: string } | null };

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => PromiseLike<QueryResult>;
};

export type CanonicalCredentialSupabase = {
  from: (table: string) => unknown;
};

export type CanonicalActiveInstagramCredential = Record<string, unknown> & {
  account_id: string;
  provider: "instagram";
  status: "active";
};

export type CanonicalActiveInstagramCredentialResult =
  | { status: "selected"; credential: CanonicalActiveInstagramCredential }
  | { status: "missing"; credential: null }
  | { status: "invariant_violation"; credential: null; reason: "multiple_active_instagram_credentials" };

function readRows(value: unknown): CanonicalActiveInstagramCredential[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is CanonicalActiveInstagramCredential => (
    Boolean(row) && typeof row === "object" && !Array.isArray(row)
  ));
}

/**
 * Loads the single canonical active Instagram credential for an account.
 * Two rows are requested deliberately so duplicate-active corruption fails
 * closed instead of being hidden by LIMIT 1.
 */
export async function loadCanonicalActiveInstagramCredential(
  supabase: CanonicalCredentialSupabase,
  accountId: string,
): Promise<CanonicalActiveInstagramCredentialResult> {
  const result = await (supabase.from("account_credentials") as QueryBuilder)
    .select("account_id,provider,status,reauth_required,reauth_reason,credentials_version")
    .eq("account_id", accountId)
    .eq("provider", "instagram")
    .eq("status", "active")
    .order("credentials_version", { ascending: false })
    .limit(2) as QueryResult;

  if (result.error) {
    throw new Error(result.error.message || "account_credentials_unavailable");
  }

  const rows = readRows(result.data);
  if (rows.length === 0) return { status: "missing", credential: null };
  if (rows.length > 1) {
    return {
      status: "invariant_violation",
      credential: null,
      reason: "multiple_active_instagram_credentials",
    };
  }
  return { status: "selected", credential: rows[0] };
}
