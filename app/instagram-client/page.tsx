import { redirect } from "next/navigation";
import { requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import { projectClientAccountRow } from "@/lib/instagram-client/account-projection";
import { loadClientAccountInsights, type ClientAccountInsights } from "@/lib/instagram-client/load-account-insights";
import { getClientWorkspaceView, type ClientWorkspaceView } from "@/lib/instagram-client/workspace-data";
import ClientDashboard from "./ClientDashboard";

export const dynamic = "force-dynamic";

type ClientDashboardActionNotification = {
  id: string;
  accountId: string;
  username: string;
  type: "password_update_required";
  status: string;
  message: string;
  createdAt: string | null;
  actionHref: string;
};
type ClientInstagramAccount = {
  accountId: string;
  username: string;
  packageLabel: string;
  accountStatus: string;
  onboardingStatus: string;
  provisioningStatus: string;
  loginStatus: string;
  assignmentStatus: string;
  readinessLabel: string;
  connected: boolean;
};

type SupabaseRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

async function getClientDashboardNotifications(clientId: string): Promise<ClientDashboardActionNotification[]> {
  if (!clientId) return [];

  const supabase = createSupabaseClient();
  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id")
    .eq("client_id", clientId)
    .limit(100);

  if (linkError || !Array.isArray(links) || links.length === 0) return [];

  const accountIds = [...new Set((links as SupabaseRecord[]).map((row) => readString(row.account_id)).filter(Boolean))];
  if (!accountIds.length) return [];

  const [{ data: actions }, { data: accounts }] = await Promise.all([
    supabase
      .from("account_dashboard_actions")
      .select("id,account_id,status,safe_client_message,action_deep_link,created_at")
      .in("account_id", accountIds)
      .eq("action_type", "update_instagram_password")
      .eq("audience", "client")
      .in("status", ["pending", "acknowledged", "pending_verification"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ig_accounts")
      .select("id,username")
      .in("id", accountIds),
  ]);

  const usernamesById = new Map((Array.isArray(accounts) ? accounts as SupabaseRecord[] : [])
    .map((row): [string, string] => [readString(row.id), readString(row.username, "Instagram account")])
    .filter(([id]) => Boolean(id)));

  return (Array.isArray(actions) ? actions as SupabaseRecord[] : []).map((row) => {
    const accountId = readString(row.account_id);
    const username = usernamesById.get(accountId) ?? "Instagram account";
    return {
      id: readString(row.id, `${accountId}-password-update`),
      accountId,
      username,
      type: "password_update_required",
      status: readString(row.status, "pending"),
      message: readString(
        row.safe_client_message,
        `Password update required for @${username}. Please update your Instagram password so we can reconnect your account safely.`,
      ),
      createdAt: readString(row.created_at) || null,
      actionHref: readString(row.action_deep_link, "/instagram-client?view=account"),
    };
  });
}

async function getClientDashboardAccounts(clientId: string): Promise<ClientInstagramAccount[]> {
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

  const [{ data: accounts }, { data: packages }] = await Promise.all([
    supabase
      .from("ig_accounts")
      .select("id,username,status,admin_lifecycle_status")
      .in("id", accountIds),
    supabase
      .from("account_commercial_packages")
      .select("account_id,package_code,status")
      .in("account_id", accountIds)
      .eq("status", "active"),
  ]);

  const packageByAccount = new Map((Array.isArray(packages) ? packages as SupabaseRecord[] : [])
    .map((row): [string, string] => [readString(row.account_id), readString(row.package_code, "growth")])
    .filter(([id]) => Boolean(id)));
  const linkByAccount = new Map((links as SupabaseRecord[])
    .map((row): [string, SupabaseRecord] => [readString(row.account_id), row])
    .filter(([id]) => Boolean(id)));

  return (Array.isArray(accounts) ? accounts as SupabaseRecord[] : [])
    .map((row) => {
      const accountId = readString(row.id);
      const link = linkByAccount.get(accountId);
      const loginStatus = readString(link?.login_status, "unknown");
      const onboardingStatus = readString(link?.onboarding_status, "pending");
      const provisioningStatus = readString(link?.provisioning_status, "not_started");
      const assignmentStatus = onboardingStatus === "ready" ? "assigned" : "pending_assignment";
      return projectClientAccountRow({
        accountId,
        username: readString(row.username, "Instagram account"),
        packageLabel: packageByAccount.get(accountId) || "Growth",
        accountStatus: readString(row.admin_lifecycle_status, readString(row.status, "active")),
        onboardingStatus,
        provisioningStatus,
        loginStatus,
        assignmentStatus,
      });
    })
    .filter((row) => Boolean(row.accountId));
}

function sortClientInstagramAccounts(accounts: ClientInstagramAccount[]) {
  return [...accounts].sort((left, right) => left.username.localeCompare(right.username));
}

export default async function InstagramClientPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (userContext.role === "superadmin") {
    redirect("/instagram-dashboard");
  }

  const loginEmail = await (async () => {
    try {
      const supabase = createSupabaseClient();
      const { data } = await supabase.auth.admin.getUserById(userContext.userId);
      return readString(data.user?.email, "");
    } catch {
      return "";
    }
  })();

  const [notifications, accounts, workspace] = await Promise.all([
    getClientDashboardNotifications(userContext.tenantId),
    getClientDashboardAccounts(userContext.tenantId),
    getClientWorkspaceView(userContext.tenantId, loginEmail),
  ]);
  const orderedAccounts = sortClientInstagramAccounts(accounts);

  const primaryAccountId = orderedAccounts[0]?.accountId ?? "";
  const accountInsights: ClientAccountInsights | null = primaryAccountId
    ? await loadClientAccountInsights(primaryAccountId)
    : null;

  return (
    <ClientDashboard
      userId={userContext.userId}
      tenantId={userContext.tenantId}
      loginEmail={loginEmail}
      initialNotifications={notifications}
      initialAccounts={orderedAccounts}
      initialWorkspace={workspace}
      initialAccountInsights={accountInsights}
    />
  );
}
