import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_MAX_LINKED_ACCOUNTS, type PlanKey } from "./catalog.ts";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export type PlanChangeCapacityResult =
  | { ok: true }
  | {
    ok: false;
    code: "downsell_capacity_exceeded";
    activeLinkedAccounts: number;
    targetPlanMaxAccounts: number;
    messageFr: string;
    messageEn: string;
  };

export async function evaluatePlanChangeCapacity(
  supabase: SupabaseClient,
  clientId: string,
  targetPlanKey: PlanKey,
): Promise<PlanChangeCapacityResult> {
  const { data: links, error } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,login_status,onboarding_status")
    .eq("client_id", clientId)
    .limit(200);

  if (error) {
    return {
      ok: false,
      code: "downsell_capacity_exceeded",
      activeLinkedAccounts: 0,
      targetPlanMaxAccounts: PLAN_MAX_LINKED_ACCOUNTS[targetPlanKey],
      messageFr: "Impossible de vérifier vos comptes Instagram pour le moment. Réessayez ou contactez le support.",
      messageEn: "Could not verify your Instagram accounts right now. Try again or contact support.",
    };
  }

  const rows = Array.isArray(links) ? links as Row[] : [];
  const activeLinkedAccounts = rows.filter((row) => {
    const loginStatus = readString(row.login_status);
    const onboardingStatus = readString(row.onboarding_status);
    return loginStatus === "connected" || onboardingStatus === "ready" || Boolean(readString(row.account_id));
  }).length;

  const targetPlanMaxAccounts = PLAN_MAX_LINKED_ACCOUNTS[targetPlanKey];
  if (activeLinkedAccounts > targetPlanMaxAccounts) {
    return {
      ok: false,
      code: "downsell_capacity_exceeded",
      activeLinkedAccounts,
      targetPlanMaxAccounts,
      messageFr:
        `Votre espace utilise ${activeLinkedAccounts} compte(s) Instagram actif(s), alors que la formule ${targetPlanKey} en autorise ${targetPlanMaxAccounts}. Réduisez vos comptes actifs ou contactez le support.`,
      messageEn:
        `Your workspace uses ${activeLinkedAccounts} active Instagram account(s), but the ${targetPlanKey} plan allows ${targetPlanMaxAccounts}. Remove active accounts or contact support.`,
    };
  }

  return { ok: true };
}
