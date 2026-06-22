import { createSupabaseClient } from "@/lib/supabase";
import { runReadinessNow } from "@/lib/instagram-dashboard/readiness-now";
import {
  projectClientReadinessStatus,
  type ClientReadinessStatus,
} from "./client-readiness-projection";

export async function projectPassiveReadinessForAccount(
  accountId: string,
  now?: Date,
): Promise<ClientReadinessStatus> {
  const supabase = createSupabaseClient();
  const readiness = await runReadinessNow(supabase, {
    accountId,
    audience: "client",
    dryRun: true,
    mode: "readiness_only",
    now,
  });
  return projectClientReadinessStatus(readiness);
}

export async function projectPassiveReadinessByAccountId(
  accountIds: string[],
  now?: Date,
): Promise<Map<string, ClientReadinessStatus>> {
  if (!accountIds.length) return new Map();
  const entries = await Promise.all(
    accountIds.map(async (accountId) => {
      const status = await projectPassiveReadinessForAccount(accountId, now);
      return [accountId, status] as const;
    }),
  );
  return new Map(entries);
}
