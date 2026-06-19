import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeClientCampaignInteractionBreakdown } from "../lib/instagram-client/client-campaign-interaction-stats.ts";

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

const since = new Date();
since.setUTCDate(since.getUTCDate() - 90);
since.setUTCHours(0, 0, 0, 0);

const [{ data: settings }, { data: account }, { data: events, error }] = await Promise.all([
  supabase.from("ig_account_settings").select("timezone").eq("account_id", accountId).maybeSingle(),
  supabase.from("ig_accounts").select("username").eq("id", accountId).maybeSingle(),
  supabase
    .from("ig_interaction_events")
    .select("id,event_type,event_status,interaction_type,event_at,created_at")
    .eq("account_id", accountId)
    .gte("event_at", since.toISOString())
    .order("event_at", { ascending: false })
    .limit(10000),
]);

if (error) {
  console.error(error.message);
  process.exit(1);
}

const breakdown = computeClientCampaignInteractionBreakdown(events ?? [], settings?.timezone ?? null);
console.log(JSON.stringify({
  account_id: accountId,
  username: account?.username ?? null,
  business_timezone: breakdown.businessTimezone,
  month_total: breakdown.monthTotal,
  today_total: breakdown.todayTotal,
  month_by_action_type: breakdown.monthByActionType,
  today_by_action_type: breakdown.todayByActionType,
}, null, 2));
