import { createSupabaseClient } from "@/lib/supabase";
import { getAccountPackageSummaries } from "@/app/instagram-dashboard/package-summary-data";
import { projectClientAccountRow, type ClientAccountRow } from "./account-projection";
import { readString } from "./guards";
import { loadClientConnectProgress } from "./load-client-connect-progress";
import { isActiveClientConnectStatus, shouldSuppressPassiveReadyToConnect } from "./connect-operation-state";
import { projectPassiveReadinessByAccountId } from "./project-client-workspace-readiness";

type SupabaseRecord = Record<string, unknown>;

function packageLabelFromCode(code: string) {
  const normalized = code.toLowerCase();
  if (normalized === "starter") return "Starter";
  if (normalized === "pro") return "Pro";
  if (normalized === "enterprise") return "Enterprise";
  return "Growth";
}

async function assignmentStatusByAccount(accountIds: string[]) {
  if (!accountIds.length) return new Map<string, string>();
  const supabase = createSupabaseClient();
  const { data } = await supabase
    .from("account_assignments")
    .select("account_id,status")
    .in("account_id", accountIds)
    .limit(500);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as SupabaseRecord[]) {
    const accountId = readString(row.account_id, "");
    const status = normalizeAssignmentStatus(readString(row.status, ""));
    if (!accountId) continue;
    if (status === "assigned") map.set(accountId, "assigned");
    else if (!map.has(accountId)) map.set(accountId, "pending_assignment");
  }
  return map;
}

function normalizeAssignmentStatus(status: string) {
  const normalized = status.toLowerCase();
  if (["active", "assigned", "scheduled", "running"].includes(normalized)) return "assigned";
  if (["cancelled", "released", "ended", "failed"].includes(normalized)) return "none";
  return "pending_assignment";
}

export async function loadClientInstagramAccounts(clientId: string): Promise<ClientAccountRow[]> {
  if (!clientId) return [];
  const supabase = createSupabaseClient();
  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,onboarding_status,provisioning_status,login_status")
    .eq("client_id", clientId)
    .limit(100);

  if (linkError || !Array.isArray(links) || links.length === 0) return [];
  const accountIds = [...new Set((links as SupabaseRecord[]).map((row) => readString(row.account_id)).filter(Boolean))];
  if (!accountIds.length) return [];

  const [{ data: accounts }, packageSummaries, assignmentMap] = await Promise.all([
    supabase
      .from("ig_accounts")
      .select("id,username,status,admin_lifecycle_status")
      .in("id", accountIds),
    getAccountPackageSummaries(accountIds),
    assignmentStatusByAccount(accountIds),
  ]);

  const linkByAccount = new Map((links as SupabaseRecord[])
    .map((row): [string, SupabaseRecord] => [readString(row.account_id), row])
    .filter(([id]) => Boolean(id)));

  const accountRows = (Array.isArray(accounts) ? accounts as SupabaseRecord[] : [])
    .map((row) => {
      const accountId = readString(row.id);
      const link = linkByAccount.get(accountId);
      const loginStatus = readString(link?.login_status, "unknown");
      const onboardingStatus = readString(link?.onboarding_status, "pending");
      const packageSummary = packageSummaries.get(accountId);
      const assignmentStatus = assignmentMap.get(accountId)
        ?? (onboardingStatus === "ready" ? "assigned" : "pending_assignment");

      return {
        accountId,
        username: readString(row.username, "Instagram account"),
        packageLabel: packageSummary?.commercialPackageLabel || packageLabelFromCode(readString(packageSummary?.commercialPackageCode, "growth")),
        accountStatus: readString(row.admin_lifecycle_status, readString(row.status, "active")),
        onboardingStatus,
        provisioningStatus: readString(link?.provisioning_status, "not_started"),
        loginStatus,
        assignmentStatus,
        connected: loginStatus.toLowerCase() === "connected",
      };
    })
    .filter((row) => Boolean(row.accountId));

  const disconnectedAccountIds = accountRows
    .filter((row) => !row.connected)
    .map((row) => row.accountId);
  const [readinessByAccount, connectStatusByAccount] = await Promise.all([
    projectPassiveReadinessByAccountId(disconnectedAccountIds),
    loadActiveConnectStatusByAccount(disconnectedAccountIds),
  ]);

  return accountRows
    .map((row) => {
      const activeConnectStatus = connectStatusByAccount.get(row.accountId) ?? null;
      const passiveReadiness = row.connected
        ? "already_connected"
        : (readinessByAccount.get(row.accountId) ?? "");
      const readinessStatus = row.connected
        ? "already_connected"
        : (activeConnectStatus && shouldSuppressPassiveReadyToConnect(activeConnectStatus)
          ? ""
          : passiveReadiness);

      return projectClientAccountRow({
        accountId: row.accountId,
        username: row.username,
        packageLabel: row.packageLabel,
        accountStatus: row.accountStatus,
        onboardingStatus: row.onboardingStatus,
        provisioningStatus: row.provisioningStatus,
        loginStatus: row.loginStatus,
        assignmentStatus: row.assignmentStatus,
        readinessStatus,
        activeConnectStatus,
        operationPending: isActiveClientConnectStatus(activeConnectStatus),
      });
    })
    .sort((left, right) => left.username.localeCompare(right.username));
}

async function loadActiveConnectStatusByAccount(accountIds: string[]) {
  const map = new Map<string, string>();
  if (!accountIds.length) return map;

  await Promise.all(accountIds.map(async (accountId) => {
    try {
      const progress = await loadClientConnectProgress({ accountId });
      if (isActiveClientConnectStatus(progress.connect_status)) {
        map.set(accountId, progress.connect_status);
      }
    } catch {
      // Passive readiness remains the fallback when runtime progress is unavailable.
    }
  }));

  return map;
}

export async function loadClientInstagramAccount(
  clientId: string,
  accountId: string,
): Promise<ClientAccountRow | null> {
  const accounts = await loadClientInstagramAccounts(clientId);
  return accounts.find((row) => row.accountId === accountId) ?? null;
}
