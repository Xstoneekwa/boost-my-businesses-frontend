export type AdminDashboardConfig = {
  url: string;
  token: string;
};

const adminDashboardTokenEnv = ["ADMIN_DASHBOARD", "INTERNAL_API_TOKEN"].join("_");

export function adminDashboardConfig(env: NodeJS.ProcessEnv = process.env): AdminDashboardConfig | null {
  const explicitUrl = env.ADMIN_DASHBOARD_API_URL?.trim();
  const baseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const url = explicitUrl || (baseUrl ? `${baseUrl}/functions/v1/admin-dashboard` : "");
  const token = env[adminDashboardTokenEnv]?.trim();

  if (!url || !token) return null;
  return { url, token };
}
