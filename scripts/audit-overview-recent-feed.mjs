#!/usr/bin/env node
/**
 * One-off reconciliation for overview recent feed — local audit only.
 * Usage: node --env-file=.env.local --experimental-strip-types scripts/audit-overview-recent-feed.mjs [accountId]
 */
import { createClient } from "@supabase/supabase-js";
import {
  buildClientOverviewRecentFeed,
  buildOverviewRecentFeedGroupDetails,
} from "../lib/instagram-client/client-overview-recent-feed-projection.ts";

const ACCOUNT_ID = process.argv[2] || "83de9cc9-5c37-42d1-9edc-c924352b17b1";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const now = new Date();
const since = new Date();
since.setUTCDate(since.getUTCDate() - 90);
since.setUTCHours(0, 0, 0, 0);

const [accountResult, settingsResult, eventsResult] = await Promise.all([
  supabase.from("ig_accounts").select("id,username").eq("id", ACCOUNT_ID).maybeSingle(),
  supabase.from("ig_account_settings").select("timezone").eq("account_id", ACCOUNT_ID).maybeSingle(),
  supabase
    .from("ig_interaction_events")
    .select("id,account_id,run_id,request_id,session_id,event_type,event_status,interaction_type,event_at,created_at,username,source_target_username")
    .eq("account_id", ACCOUNT_ID)
    .gte("event_at", since.toISOString())
    .order("event_at", { ascending: false })
    .limit(10000),
]);

if (accountResult.error || !accountResult.data) {
  console.error("Account not found", accountResult.error);
  process.exit(1);
}

const timezone = settingsResult.data?.timezone || "Africa/Johannesburg";
const username = String(accountResult.data.username || "").replace(/^@+/, "").toLowerCase();
const rows = eventsResult.data ?? [];

const feed = buildClientOverviewRecentFeed(rows, {
  accountId: ACCOUNT_ID,
  accountUsername: username,
  businessTimezone: timezone,
  windowDays: 14,
  limit: 5,
  now,
});

const groups = buildOverviewRecentFeedGroupDetails(rows, {
  accountId: ACCOUNT_ID,
  accountUsername: username,
  businessTimezone: timezone,
  windowDays: 14,
  now,
}).slice(0, 5);

function actionLabel(kind) {
  return ({
    follow: "Abonnements",
    like: "J'aime",
    dm: "Messages",
    story: "Stories",
    unfollow: "Retraits",
  })[kind] || kind;
}

const table = groups.map((group, index) => {
  const item = feed[index];
  return {
    action: actionLabel(group.actionKind),
    compte_cible: group.sourceTargetUsername ? `@${group.sourceTargetUsername}` : "—",
    date_groupe: new Date(group.latestAt).toLocaleString("fr-FR", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    events_reels: group.count,
    comptes_touches_distincts: group.touched.length,
    nombre_phrase: item?.count ?? group.count,
    bubble_plus_n: item?.overflowCount ?? Math.max(0, group.touched.length - 3),
    groupe_interne: group.groupKey.replace(/run:|req:|sess:/g, "[session]:"),
    resume: item?.summaryFr ?? null,
  };
});

console.log(JSON.stringify({
  account_id: ACCOUNT_ID,
  username: `@${username}`,
  timezone,
  feed_groups: table,
}, null, 2));
