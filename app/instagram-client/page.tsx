import { redirect } from "next/navigation";
import { requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
import { loadClientInstagramAccounts } from "@/lib/instagram-client/load-client-instagram-accounts";
import { loadClientAccountInsights, type ClientAccountInsights } from "@/lib/instagram-client/load-account-insights";
import { loadClientFollowerGrowthSeries } from "@/lib/instagram-client/load-client-follower-growth";
import { getClientWorkspaceView, type ClientWorkspaceView } from "@/lib/instagram-client/workspace-data";
import ClientDashboard from "./ClientDashboard";
import {
  loadClientAccountNotificationsForClient,
  reconcileClientAccountNotificationsForClient,
} from "@/lib/instagram-client/client-account-notifications";

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
  clientReadinessStatus?: string;
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

  const [{ data: passwordActions }, { data: verificationActions }, { data: accounts }, { data: clientAccounts }] = await Promise.all([
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
      .from("account_dashboard_actions")
      .select("id,account_id,status,action_type")
      .in("account_id", accountIds)
      .eq("action_type", "enter_email_verification_code")
      .in("status", ["pending", "acknowledged", "pending_verification", "code_submitted"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ig_accounts")
      .select("id,username")
      .in("id", accountIds),
    supabase
      .from("client_instagram_accounts")
      .select("account_id,login_status,provisioning_status")
      .in("account_id", accountIds),
  ]);

  const verificationBlockedAccountIds = new Set<string>();
  for (const row of (Array.isArray(verificationActions) ? verificationActions as SupabaseRecord[] : [])) {
    const accountId = readString(row.account_id);
    if (accountId) verificationBlockedAccountIds.add(accountId);
  }
  for (const row of (Array.isArray(clientAccounts) ? clientAccounts as SupabaseRecord[] : [])) {
    const accountId = readString(row.account_id);
    const loginStatus = readString(row.login_status).toLowerCase();
    const provisioningStatus = readString(row.provisioning_status).toLowerCase();
    if (!accountId) continue;
    if (loginStatus === "verification_pending" || provisioningStatus === "login_verification_pending") {
      verificationBlockedAccountIds.add(accountId);
    }
  }

  const usernamesById = new Map((Array.isArray(accounts) ? accounts as SupabaseRecord[] : [])
    .map((row): [string, string] => [readString(row.id), readString(row.username, "Instagram account")])
    .filter(([id]) => Boolean(id)));

  return (Array.isArray(passwordActions) ? passwordActions as SupabaseRecord[] : [])
    .filter((row) => !verificationBlockedAccountIds.has(readString(row.account_id)))
    .map((row) => {
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
  return loadClientInstagramAccounts(clientId);
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

  const [notifications, accounts, workspace, accountNotifications] = await Promise.all([
    getClientDashboardNotifications(userContext.tenantId),
    getClientDashboardAccounts(userContext.tenantId),
    getClientWorkspaceView(userContext.tenantId, loginEmail),
    (async () => {
      const supabase = createSupabaseClient();
      await reconcileClientAccountNotificationsForClient(supabase, userContext.tenantId);
      return loadClientAccountNotificationsForClient(supabase, userContext.tenantId);
    })(),
  ]);
  const orderedAccounts = sortClientInstagramAccounts(accounts);

  const primaryAccountId = orderedAccounts[0]?.accountId ?? "";
  const [accountInsights, followerGrowth] = primaryAccountId
    ? await Promise.all([
      loadClientAccountInsights(primaryAccountId),
      loadClientFollowerGrowthSeries(primaryAccountId),
    ])
    : [null, null];

  return (
    <ClientDashboard
      userId={userContext.userId}
      tenantId={userContext.tenantId}
      loginEmail={loginEmail}
      initialNotifications={notifications}
      initialAccountNotifications={accountNotifications}
      initialAccounts={orderedAccounts}
      initialWorkspace={workspace}
      initialAccountInsights={accountInsights}
      initialFollowerGrowth={followerGrowth}
    />
  );
}
