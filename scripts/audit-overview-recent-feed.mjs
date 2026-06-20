#!/usr/bin/env node
/**
 * One-off reconciliation for overview recent feed — local audit only.
 * Usage: node --env-file=.env.local --experimental-strip-types scripts/audit-overview-recent-feed.mjs [accountId]
 */
import { createClient } from "@supabase/supabase-js";
import {
  buildClientOverviewRecentFeed,
  buildOverviewRecentFeedGroupDetails,
  formatOverviewRecentFeedBusinessDate,
  resolveOverviewRecentActiveBusinessDays,
} from "../lib/instagram-client/client-overview-recent-feed-projection.ts";
import { mapOverviewRecentFeedSourceEvent } from "../lib/instagram-client/client-overview-recent-feed-projection.ts";

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

const mappedEvents = rows
  .map((row) => mapOverviewRecentFeedSourceEvent(row, { accountId: ACCOUNT_ID, businessTimezone: timezone }))
  .filter(Boolean);
const activeDays = resolveOverviewRecentActiveBusinessDays(mappedEvents, 2);

const feed = buildClientOverviewRecentFeed(rows, {
  accountId: ACCOUNT_ID,
  accountUsername: username,
  businessTimezone: timezone,
  limit: 5,
});

const allGroups = buildOverviewRecentFeedGroupDetails(rows, {
  accountId: ACCOUNT_ID,
  accountUsername: username,
  businessTimezone: timezone,
});

function actionLabel(kind) {
  return ({
    follow: "Abonnements",
    like: "J'aime",
    dm: "Messages",
    story: "Stories",
    unfollow: "Retraits",
  })[kind] || kind;
}

const table = allGroups.map((group) => {
  const item = feed.find((entry) => entry.id === `${group.actionKind}-${group.sourceTargetUsername ?? "none"}-${group.businessDayKey}`);
  return {
    date_business: formatOverviewRecentFeedBusinessDate(group.businessDayKey, "fr"),
    action: actionLabel(group.actionKind),
    compte_cible: group.sourceTargetUsername ? `@${group.sourceTargetUsername}` : "—",
    events_success: group.count,
    comptes_touches_distincts: group.touched.length,
    texte_ui: item?.summaryFr ?? null,
    bubble_plus_n: item?.overflowCount ?? Math.max(0, group.touched.length - 3),
  };
});

console.log(JSON.stringify({
  account_id: ACCOUNT_ID,
  username: `@${username}`,
  timezone,
  active_business_days: activeDays,
  feed_groups: table,
  overview_top5: feed.map((item) => ({
    date_business: formatOverviewRecentFeedBusinessDate(item.businessDayKey, "fr"),
    action: actionLabel(item.actionKind),
    compte_cible: item.sourceTargetUsername ? `@${item.sourceTargetUsername}` : "—",
    events_success: item.count,
    comptes_touches_distincts: item.distinctTouchedCount,
    texte_ui: item.summaryFr,
    bubble_plus_n: item.overflowCount,
  })),
}, null, 2));
