import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createSupabaseClient } from "@/lib/supabase";
import {
  accountProtectionMutationBlocked,
  buildAccountProtectionListSnapshot,
  type AccountProtectionListKind,
  type AccountProtectionListOperation,
} from "./account-protection-list-contract";

type SupabaseRecord = Record<string, unknown>;

export type AccountProtectionListSnapshot = {
  items: string[];
  size: number;
  version: number;
  updatedAt: string | null;
  status: "loaded_empty" | "loaded_with_items";
  replayed?: boolean;
  mutationVersion?: number;
};

export class AccountProtectionListServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function loadAccount(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status,archived_at,trashed_at")
    .eq("id", accountId)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new AccountProtectionListServiceError(503, "account_lookup_failed");
  if (!data) throw new AccountProtectionListServiceError(404, "account_not_found");
  return data;
}

export async function readAccountProtectionList(
  accountId: string,
  listKind: AccountProtectionListKind,
): Promise<AccountProtectionListSnapshot> {
  await loadAccount(accountId);
  const supabase = createSupabaseClient();
  const [entriesResult, versionResult] = await Promise.all([
    supabase
      .from("account_protection_list_entries")
      .select("normalized_username")
      .eq("account_id", accountId)
      .eq("list_kind", listKind)
      .eq("active", true)
      .order("normalized_username", { ascending: true }),
    supabase
      .from("account_protection_list_versions")
      .select("version,updated_at")
      .eq("account_id", accountId)
      .eq("list_kind", listKind)
      .maybeSingle<SupabaseRecord>(),
  ]);
  if (entriesResult.error || versionResult.error) {
    throw new AccountProtectionListServiceError(503, "protection_list_read_failed");
  }
  const items = (entriesResult.data ?? [])
    .map((row) => String(row.normalized_username ?? ""))
    .filter(Boolean);
  const version = Number(versionResult.data?.version ?? 0);
  return buildAccountProtectionListSnapshot(
    items,
    version,
    typeof versionResult.data?.updated_at === "string" ? versionResult.data.updated_at : null,
  );
}

export async function mutateAccountProtectionList(input: {
  accountId: string;
  listKind: AccountProtectionListKind;
  operation: AccountProtectionListOperation;
  items?: string[];
  add?: string[];
  remove?: string[];
  sourceSurface: "client_dashboard" | "admin_dashboard";
  actorAuthUserId: string | null;
  idempotencyKey: string;
  expectedVersion: number;
}) {
  const account = await loadAccount(input.accountId);
  if (accountProtectionMutationBlocked(account)) {
    throw new AccountProtectionListServiceError(409, "account_lifecycle_conflict");
  }
  const payload = {
    accountId: input.accountId,
    listKind: input.listKind,
    operation: input.operation,
    sourceSurface: input.sourceSurface,
    actorAuthUserId: input.actorAuthUserId,
    items: input.items ?? [],
    add: input.add ?? [],
    remove: input.remove ?? [],
  };
  const requestFingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc("mutate_account_protection_list", {
    p_account_id: input.accountId,
    p_list_kind: input.listKind,
    p_operation: input.operation,
    p_items: input.items ?? [],
    p_add_items: input.add ?? [],
    p_remove_items: input.remove ?? [],
    p_source_surface: input.sourceSurface,
    p_actor_auth_user_id: input.actorAuthUserId,
    p_request_id: randomUUID(),
    p_idempotency_key: input.idempotencyKey,
    p_expected_version: input.expectedVersion,
    p_request_fingerprint: requestFingerprint,
  });
  if (error) throw new AccountProtectionListServiceError(503, "protection_list_mutation_failed");
  const result = (data ?? {}) as SupabaseRecord;
  if (result.ok !== true) {
    const code = String(result.error ?? "protection_list_mutation_failed");
    if (code === "version_conflict" || code === "account_lifecycle_conflict") {
      throw new AccountProtectionListServiceError(409, code, { version: Number(result.version ?? 0) });
    }
    if (code === "idempotency_conflict") {
      throw new AccountProtectionListServiceError(409, code, { version: Number(result.version ?? 0) });
    }
    throw new AccountProtectionListServiceError(400, code);
  }
  const items = Array.isArray(result.items) ? result.items.map(String) : [];
  return {
    items,
    size: items.length,
    version: Number(result.version ?? 0),
    updatedAt: typeof result.updated_at === "string" ? result.updated_at : null,
    status: items.length ? "loaded_with_items" as const : "loaded_empty" as const,
    replayed: result.replayed === true,
    mutationVersion: Number(result.mutation_version ?? result.version ?? 0),
  };
}
