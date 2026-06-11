import { redirect } from "next/navigation";
import { requireInstagramDashboardAccess } from "@/lib/restaurant-analytics/session";
import { createSupabaseClient } from "@/lib/supabase";
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

export default async function InstagramClientPage() {
  const userContext = await requireInstagramDashboardAccess();

  if (userContext.role === "superadmin") {
    redirect("/instagram-dashboard");
  }

  const notifications = await getClientDashboardNotifications(userContext.tenantId);

  return (
    <ClientDashboard
      userId={userContext.userId}
      tenantId={userContext.tenantId}
      initialNotifications={notifications}
    />
  );
}
