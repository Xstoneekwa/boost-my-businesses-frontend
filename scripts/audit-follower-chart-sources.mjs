import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return env;
}

const accountId = process.argv[2] || "83de9cc9-5c37-42d1-9edc-c924352b17b1";
const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function tableExists(name) {
  const { data, error } = await supabase.from(name).select("*").limit(1);
  if (error) return { exists: false, error: error.message };
  return { exists: true, sample: data?.[0] ?? null };
}

const [
  accountRes,
  linkRes,
  settingsRes,
  snapshotTable,
  altTables,
] = await Promise.all([
  supabase
    .from("ig_accounts")
    .select("id,username,followers_count,updated_at,created_at,status,admin_lifecycle_status,avatar_checked_at,public_profile_metadata")
    .eq("id", accountId)
    .maybeSingle(),
  supabase
    .from("client_instagram_accounts")
    .select("client_id,account_id,onboarding_status,login_status,provisioning_status,created_at,updated_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(5),
  supabase
    .from("ig_account_settings")
    .select("timezone,updated_at")
    .eq("account_id", accountId)
    .maybeSingle(),
  tableExists("ig_account_follower_snapshots"),
  Promise.all([
    tableExists("account_follower_snapshots"),
    tableExists("ig_account_stats"),
    tableExists("ig_account_metrics_snapshots"),
  ]),
]);

console.log(JSON.stringify({
  account_id: accountId,
  ig_accounts: accountRes.data ?? null,
  ig_accounts_error: accountRes.error?.message ?? null,
  client_instagram_accounts: linkRes.data ?? [],
  client_link_error: linkRes.error?.message ?? null,
  ig_account_settings: settingsRes.data ?? null,
  snapshot_tables: {
    ig_account_follower_snapshots: snapshotTable,
    account_follower_snapshots: altTables[0],
    ig_account_stats: altTables[1],
    ig_account_metrics_snapshots: altTables[2],
  },
}, null, 2));
