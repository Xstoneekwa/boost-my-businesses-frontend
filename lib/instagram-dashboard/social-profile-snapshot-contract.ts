import { createHash } from "node:crypto";
import { businessDayKeyFromIso, normalizeBusinessTimezone } from "./business-timezone.ts";

export type SocialProfileSnapshotTrigger =
  | "onboarding_lookup"
  | "explicit_reanalysis"
  | "session_end"
  | "daily_fallback"
  | "admin_manual_refresh";

export type SocialProfileSnapshotRow = {
  id?: string;
  account_id: string;
  username_normalized: string;
  followers_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  observed_at: string;
  snapshot_local_date: string;
  account_timezone: string;
  timezone_source: "device_assignment" | "schedule" | "platform_default";
  source_provider: "searchapi" | "http" | "device_profile_read";
  source_trigger: SocialProfileSnapshotTrigger;
  source_event_id: string | null;
  source_run_id: string | null;
  source_business_session_id: string | null;
  lookup_status: string;
  freshness_status: "fresh" | "stale" | "partial";
  idempotency_key: string;
  created_at?: string;
};

export type SocialProfileObservation = Pick<SocialProfileSnapshotRow,
  "followers_count" | "following_count" | "posts_count" | "observed_at" | "lookup_status"
>;

export const SOCIAL_PROFILE_PLATFORM_TIMEZONE = "Africa/Johannesburg";
export const SOCIAL_PROFILE_SAME_DAY_MATCH_MAX_HOURS = 18;

export function normalizeAbsoluteCount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeSocialProfileUsername(value: unknown) {
  return String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function isValidSocialProfileUsername(value: string) {
  return /^[a-z0-9._]{1,30}$/.test(value);
}

export function resolveSocialProfileTimezone(input: {
  deviceTimezone?: string | null;
  scheduleTimezone?: string | null;
}) {
  const deviceTimezone = String(input.deviceTimezone ?? "").trim();
  if (deviceTimezone && deviceTimezone !== "UTC") {
    return { timezone: normalizeBusinessTimezone(deviceTimezone), source: "device_assignment" as const };
  }
  const scheduleTimezone = String(input.scheduleTimezone ?? "").trim();
  if (scheduleTimezone && scheduleTimezone !== "UTC") {
    return { timezone: normalizeBusinessTimezone(scheduleTimezone), source: "schedule" as const };
  }
  return { timezone: SOCIAL_PROFILE_PLATFORM_TIMEZONE, source: "platform_default" as const };
}

export function planSocialProfileScheduledTrigger(input: {
  now: Date;
  timezone: string;
  latestRunFinishedAt?: string | null;
}) {
  const nowIso = input.now.toISOString();
  const localDate = businessDayKeyFromIso(nowIso, input.timezone);
  const runAt = String(input.latestRunFinishedAt ?? "");
  const runMatches = runAt && !Number.isNaN(Date.parse(runAt))
    && businessDayKeyFromIso(runAt, input.timezone) === localDate;
  if (runMatches) return { trigger: "session_end" as const, localDate };
  const hourParts = new Intl.DateTimeFormat("en", {
    timeZone: input.timezone, hour: "2-digit", hour12: false, hourCycle: "h23",
  }).formatToParts(input.now);
  const localHour = Number(hourParts.find((part) => part.type === "hour")?.value ?? 0);
  return localHour >= 23 ? { trigger: "daily_fallback" as const, localDate } : null;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function socialProfileSnapshotIdempotencyKey(input: {
  accountId: string;
  trigger: SocialProfileSnapshotTrigger;
  observedAt: string;
  timezone: string;
  sourceEventId?: string | null;
  sourceRunId?: string | null;
  sourceBusinessSessionId?: string | null;
}) {
  const eventIdentity = input.sourceEventId || input.sourceRunId || input.sourceBusinessSessionId;
  const timeIdentity = eventIdentity || businessDayKeyFromIso(input.observedAt, input.timezone);
  return hashKey(["social-profile-v1", input.accountId, input.trigger, timeIdentity].join(":"));
}

export function buildSocialProfileSnapshot(input: {
  accountId: string;
  username: string;
  observation: SocialProfileObservation;
  provider: string;
  trigger: SocialProfileSnapshotTrigger;
  deviceTimezone?: string | null;
  scheduleTimezone?: string | null;
  sourceEventId?: string | null;
  sourceRunId?: string | null;
  sourceBusinessSessionId?: string | null;
}): SocialProfileSnapshotRow | null {
  const followers = normalizeAbsoluteCount(input.observation.followers_count);
  const following = normalizeAbsoluteCount(input.observation.following_count);
  const posts = normalizeAbsoluteCount(input.observation.posts_count);
  const observedAt = new Date(input.observation.observed_at);
  const username = normalizeSocialProfileUsername(input.username);
  if (!isValidSocialProfileUsername(username) || Number.isNaN(observedAt.getTime())) return null;
  if (input.observation.lookup_status !== "found") return null;
  if (followers === null && following === null && posts === null) return null;
  const resolvedTimezone = resolveSocialProfileTimezone(input);
  const observedIso = observedAt.toISOString();
  const provider = input.provider === "http" || input.provider === "device_profile_read" ? input.provider : "searchapi";
  const populated = [followers, following, posts].filter((value) => value !== null).length;
  return {
    account_id: input.accountId,
    username_normalized: username,
    followers_count: followers,
    following_count: following,
    posts_count: posts,
    observed_at: observedIso,
    snapshot_local_date: businessDayKeyFromIso(observedIso, resolvedTimezone.timezone),
    account_timezone: resolvedTimezone.timezone,
    timezone_source: resolvedTimezone.source,
    source_provider: provider,
    source_trigger: input.trigger,
    source_event_id: input.sourceEventId ?? null,
    source_run_id: input.sourceRunId ?? null,
    source_business_session_id: input.sourceBusinessSessionId ?? null,
    lookup_status: input.observation.lookup_status || "found",
    freshness_status: populated === 3 ? "fresh" : "partial",
    idempotency_key: socialProfileSnapshotIdempotencyKey({
      accountId: input.accountId,
      trigger: input.trigger,
      observedAt: observedIso,
      timezone: resolvedTimezone.timezone,
      sourceEventId: input.sourceEventId,
      sourceRunId: input.sourceRunId,
      sourceBusinessSessionId: input.sourceBusinessSessionId,
    }),
  };
}

export function selectSnapshotForSession(input: {
  snapshots: SocialProfileSnapshotRow[];
  runId?: string | null;
  businessSessionId?: string | null;
  sessionAt: string;
  timezone: string;
  maxHours?: number;
}) {
  const valid = input.snapshots
    .filter((row) => row.lookup_status === "found")
    .filter((row) => !Number.isNaN(Date.parse(row.observed_at)))
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  const exact = valid.find((row) =>
    (input.runId && row.source_run_id === input.runId)
    || (input.businessSessionId && row.source_business_session_id === input.businessSessionId));
  if (exact) return { row: exact, match: "explicit" as const };
  const sessionMs = Date.parse(input.sessionAt);
  if (!Number.isFinite(sessionMs)) return { row: null, match: "none" as const };
  const localDate = businessDayKeyFromIso(input.sessionAt, input.timezone);
  const boundMs = (input.maxHours ?? SOCIAL_PROFILE_SAME_DAY_MATCH_MAX_HOURS) * 60 * 60 * 1000;
  const sameDay = valid.find((row) => row.snapshot_local_date === localDate
    && Math.abs(Date.parse(row.observed_at) - sessionMs) <= boundMs);
  return sameDay ? { row: sameDay, match: "same_local_date" as const } : { row: null, match: "none" as const };
}

export function projectSocialProfileSnapshots(input: {
  rows: SocialProfileSnapshotRow[];
  now?: Date;
  staleAfterHours?: number;
}) {
  const valid = input.rows
    .filter((row) => row.lookup_status === "found")
    .filter((row) => !Number.isNaN(Date.parse(row.observed_at)))
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const latest = valid.at(-1) ?? null;
  const timezone = latest?.account_timezone || SOCIAL_PROFILE_PLATFORM_TIMEZONE;
  const staleAfterHours = input.staleAfterHours ?? 36;
  const now = input.now ?? new Date();
  const isStale = latest ? now.getTime() - Date.parse(latest.observed_at) > staleAfterHours * 3600000 : false;
  const byDay = new Map<string, SocialProfileSnapshotRow>();
  for (const row of valid) byDay.set(row.snapshot_local_date, row);
  const metricStatus = (key: "followers_count" | "following_count" | "posts_count") => {
    if (!latest || latest[key] === null) return { status: "no_data" as const, latestAt: latest?.observed_at ?? null };
    return { status: isStale ? "stale" as const : "available" as const, latestAt: latest.observed_at };
  };
  return {
    timezone,
    points: [...byDay.entries()].map(([date, row]) => ({ date, row })),
    sourceStatus: {
      followers: metricStatus("followers_count"),
      followings: metricStatus("following_count"),
      posts: metricStatus("posts_count"),
    },
  };
}
