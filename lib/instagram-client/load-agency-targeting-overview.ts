import { loadTargetEligibilityCountsByAccount } from "../instagram-dashboard/account-target-eligibility";
import { loadClientInstagramAccounts } from "./load-client-instagram-accounts";
import {
  buildAgencyTargetingSummary,
  projectAgencyTargetingAccountRow,
  type ClientAgencyTargetingProjection,
} from "./client-agency-targeting-projection";
import { createSupabaseClient } from "@/lib/supabase";
import { readString } from "./guards";

export async function loadClientAgencyTargetingOverview(clientId: string): Promise<ClientAgencyTargetingProjection | null> {
  const normalizedClientId = readString(clientId);
  if (!normalizedClientId) return null;

  const accounts = await loadClientInstagramAccounts(normalizedClientId);
  if (accounts.length < 2) return null;

  const supabase = createSupabaseClient();
  const countsByAccount = await loadTargetEligibilityCountsByAccount(
    supabase,
    accounts.map((row) => row.accountId),
  );

  const rows = accounts.map((account) => projectAgencyTargetingAccountRow(
    account,
    countsByAccount.get(account.accountId) ?? {
      total: 0,
      valid: 0,
      eligible: 0,
      pending: 0,
      rejected: 0,
      archived: 0,
    },
  ));

  return {
    summary: buildAgencyTargetingSummary(rows),
    accounts: rows,
  };
}
