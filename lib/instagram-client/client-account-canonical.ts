import type { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards.ts";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

const INTERNAL_ERROR_PATTERN = /does not exist|relation|column|syntax error|postgres|supabase|rpc|violates|permission denied/i;

export function sanitizeClientApiError(message: string, fallback: string) {
  const normalized = readString(message);
  if (!normalized) return fallback;
  if (INTERNAL_ERROR_PATTERN.test(normalized)) return fallback;
  return normalized;
}

/** Username lives on ig_accounts; client_instagram_accounts is ownership link only. */
export async function loadCanonicalIgAccountUsername(
  supabase: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) return null;

  const { data, error } = await supabase
    .from("ig_accounts")
    .select("username")
    .eq("id", normalizedAccountId)
    .maybeSingle();

  if (error) return null;
  const username = readString(data?.username, "");
  return username || null;
}

export async function loadCanonicalIgAccountUsernames(
  supabase: SupabaseClient,
  accountIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;

  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id,username")
    .in("id", ids);

  if (error || !Array.isArray(data)) return map;

  for (const row of data as Array<{ id?: unknown; username?: unknown }>) {
    const accountId = readString(row.id, "");
    const username = readString(row.username, "");
    if (accountId && username) map.set(accountId, username);
  }
  return map;
}
