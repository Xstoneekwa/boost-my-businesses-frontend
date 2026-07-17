type RecordValue = Record<string, unknown>;

export type ProfileSocialCounters = {
  follows: number;
  unfollows: number;
  likes: number;
  comments: number;
  dms: number;
  stories: number;
  interactionsTotal: number;
};

export const TOTAL_INTERACTIONS_DEFINITION =
  "follows + unfollows + likes + comments + dms + stories";

export const STATS_TOTAL_INTERACTIONS_DEFINITION =
  "follow_count + unfollow_count + like_count + comment_count + dm_count + watch_count";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readRecord(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function blankSocialCounters(): ProfileSocialCounters {
  return {
    follows: 0,
    unfollows: 0,
    likes: 0,
    comments: 0,
    dms: 0,
    stories: 0,
    interactionsTotal: 0,
  };
}

function withInteractionsTotal(counters: Omit<ProfileSocialCounters, "interactionsTotal">): ProfileSocialCounters {
  return {
    ...counters,
    interactionsTotal:
      counters.follows
      + counters.unfollows
      + counters.likes
      + counters.comments
      + counters.dms
      + counters.stories,
  };
}

export function socialActionKindFromLog(actionType: string) {
  const action = actionType.toLowerCase();
  if (action === "follow_completed") return "follows";
  if (action === "unfollow_completed") return "unfollows";
  if (
    action === "like_completed"
    || action === "post_like_completed"
    || action === "post_follow_like_completed"
  ) return "likes";
  if (action === "comment_completed" || action === "post_comment_completed") return "comments";
  if (action === "send_dm_sent" || action === "dm_sent" || action === "welcome_dm_sent" || action === "outreach_dm_sent") return "dms";
  if (action === "story_viewed" || action === "stories_viewed" || action === "story_reaction_sent" || action === "watch_completed") return "stories";
  return null;
}

function shouldCountSocialLog(row: RecordValue) {
  const status = readString(row.status, "").toLowerCase();
  if (["failed", "error", "skipped", "blocked", "dry_run"].some((blocked) => status.includes(blocked))) return false;
  return Boolean(socialActionKindFromLog(readString(row.action_type, "")));
}

function shouldCountInteractionEvent(row: RecordValue) {
  const status = readString(row.event_status, readString(row.interaction_status, "success")).toLowerCase();
  if (["failed", "error", "skipped", "blocked", "dry_run"].some((blocked) => status.includes(blocked))) return false;
  return true;
}

export function runTotalsCounters(runRows: RecordValue[]): ProfileSocialCounters {
  const counters = blankSocialCounters();
  for (const row of runRows) {
    counters.follows += readNumber(row.total_follow, 0);
    counters.likes += readNumber(row.total_like, 0);
    counters.dms += readNumber(row.total_dm, 0);
    counters.stories += readNumber(row.total_story, 0);
  }
  return withInteractionsTotal(counters);
}

function likedCountFromInteractionEvent(row: RecordValue) {
  const payload = readRecord(row.payload);
  const liked = readNumber(payload?.liked_count, 0);
  return liked > 0 ? liked : 1;
}

type SocialCounterKind = Exclude<keyof ProfileSocialCounters, "interactionsTotal">;

function verifiedInteractionKind(row: RecordValue): SocialCounterKind | null {
  const eventType = readString(row.event_type, "").toLowerCase();
  if (eventType === "follow_verified") return "follows";
  if (eventType === "unfollow_verified" || eventType === "unfollow_success") return "unfollows";
  if (eventType === "post_like_success" || eventType === "post_like_verified") return "likes";
  if (["comment_verified", "comment_sent"].includes(eventType)) return "comments";
  if (["dm_sent", "send_dm_sent", "welcome_dm_sent", "outreach_dm_sent"].includes(eventType)) return "dms";
  if (["story_viewed", "story_reaction_sent", "watch_completed"].includes(eventType)) return "stories";
  return null;
}

function verifiedInteractionIdentity(row: RecordValue, kind: SocialCounterKind) {
  const accountId = readString(row.account_id, "no_account");
  const payload = readRecord(row.payload);
  const runId = readString(row.run_id, "no_run");
  const username = readString(row.username, readString(payload?.target_username, readString(payload?.username, ""))).toLowerCase();
  if (username) return `${accountId}:${runId}:${kind}:${username}`;
  const progressKey = readString(payload?.progress_key, "");
  return progressKey || readString(row.id, `${accountId}:${runId}:${kind}:${readString(row.event_at, "unknown")}`);
}

function verifiedInteractionUnits(row: RecordValue, kind: SocialCounterKind) {
  if (kind === "likes") return likedCountFromInteractionEvent(row);
  const payload = readRecord(row.payload);
  return Math.max(1, readNumber(payload?.verified_count, 1));
}

function normalizedTarget(row: RecordValue) {
  const payload = readRecord(row.payload);
  return readString(
    row.target_username,
    readString(row.username, readString(payload?.target_username, readString(payload?.username, ""))),
  ).trim().toLowerCase();
}

function canonicalActionIdentity(row: RecordValue, kind: SocialCounterKind) {
  const accountId = readString(row.account_id, "no_account");
  const runId = readString(row.run_id, "no_run");
  const target = normalizedTarget(row);
  if (target) return `${accountId}:${runId}:${kind}:${target}`;
  return readString(row.id, `${accountId}:${runId}:${kind}`);
}

function canonicalActionUnits(row: RecordValue, kind: SocialCounterKind) {
  if (kind === "likes") {
    const payload = readRecord(row.payload);
    return Math.max(1, readNumber(payload?.liked_count, readNumber(payload?.verified_count, 1)));
  }
  return 1;
}

function actionUnitsByIdentity(rows: RecordValue[]) {
  const units = new Map<string, { kind: SocialCounterKind; units: number }>();
  for (const row of rows) {
    if (!shouldCountSocialLog(row)) continue;
    const kind = socialActionKindFromLog(readString(row.action_type, ""));
    if (!kind) continue;
    const identity = canonicalActionIdentity(row, kind);
    if (!identity) continue;
    const rowUnits = canonicalActionUnits(row, kind);
    const previous = units.get(identity);
    if (!previous || rowUnits > previous.units) units.set(identity, { kind, units: rowUnits });
  }
  return units;
}

export function actionCountersFromLogs(logRows: RecordValue[]): ProfileSocialCounters {
  const counters = blankSocialCounters();
  for (const { kind, units } of actionUnitsByIdentity(logRows).values()) {
    counters[kind] += units;
  }
  return withInteractionsTotal(counters);
}

function verifiedUnitsByIdentity(rows: RecordValue[]) {
  const units = new Map<string, { kind: SocialCounterKind; units: number }>();
  for (const row of rows) {
    if (!shouldCountInteractionEvent(row)) continue;
    const kind = verifiedInteractionKind(row);
    if (!kind) continue;
    const identity = verifiedInteractionIdentity(row, kind);
    const rowUnits = verifiedInteractionUnits(row, kind);
    const previous = units.get(identity);
    if (!previous || rowUnits > previous.units) units.set(identity, { kind, units: rowUnits });
  }
  return units;
}

export function interactionEventCounters(eventRows: RecordValue[]): ProfileSocialCounters {
  const counters = blankSocialCounters();
  const verifiedByIdentity = new Map<string, { kind: SocialCounterKind; units: number }>();
  for (const row of eventRows) {
    if (!shouldCountInteractionEvent(row)) continue;
    const kind = verifiedInteractionKind(row);
    if (!kind) continue;
    const identity = verifiedInteractionIdentity(row, kind);
    const units = verifiedInteractionUnits(row, kind);
    const previous = verifiedByIdentity.get(identity);
    if (!previous || units > previous.units) verifiedByIdentity.set(identity, { kind, units });
  }
  for (const { kind, units } of verifiedByIdentity.values()) {
    counters[kind] += units;
  }
  return withInteractionsTotal(counters);
}

export function verifiedUnfollowRowsAsInteractionEvents(rows: RecordValue[]): RecordValue[] {
  return rows
    .filter((row) => row.unfollowed === true && Boolean(readString(row.unfollowed_at, "")))
    .map((row) => ({
      id: `unfollow:${readString(row.id, "unknown")}`,
      account_id: row.account_id,
      run_id: readString(row.run_id, readString(row.last_run_id, "")) || null,
      username: row.username,
      event_type: "unfollow_verified",
      event_status: "success",
      interaction_type: "unfollow",
      event_at: row.unfollowed_at,
      created_at: row.unfollowed_at,
      payload: {
        target_username: row.username,
        evidence_source: "ig_interacted_users.unfollowed_at",
      },
    }));
}

export function lastVerifiedInteractionAt(eventRows: RecordValue[]) {
  let latest = "";
  for (const row of eventRows) {
    if (!shouldCountInteractionEvent(row) || !verifiedInteractionKind(row)) continue;
    const eventAt = readString(row.event_at, readString(row.created_at, ""));
    if (eventAt > latest) latest = eventAt;
  }
  return latest || null;
}

export function projectVerifiedRunCounters(input: {
  runId: string;
  accountId?: string;
  now?: string;
  canonicalDailyCount: ProfileSocialCounters;
  canonicalActions: RecordValue[];
  interactionEvents: RecordValue[];
}) {
  const nowMs = new Date(input.now ?? new Date().toISOString()).getTime();
  const scopedEvents = input.interactionEvents.filter((row) => {
    if (readString(row.run_id, "") !== input.runId) return false;
    if (input.accountId && readString(row.account_id, "") !== input.accountId) return false;
    const eventMs = new Date(readString(row.event_at, readString(row.created_at, ""))).getTime();
    return !Number.isFinite(eventMs) || eventMs <= nowMs;
  });
  const scopedCanonicalActions = input.canonicalActions.filter((row) => (
    readString(row.run_id, "") === input.runId
    && (!input.accountId || readString(row.account_id, "") === input.accountId)
  ));
  const activeRunVerifiedCount = interactionEventCounters(scopedEvents);
  const canonicalByIdentity = actionUnitsByIdentity(scopedCanonicalActions);
  const verifiedByIdentity = verifiedUnitsByIdentity(scopedEvents);
  const unabsorbed = blankSocialCounters();
  for (const [identity, live] of verifiedByIdentity) {
    const canonicalUnits = canonicalByIdentity.get(identity)?.units ?? 0;
    unabsorbed[live.kind] += Math.max(0, live.units - canonicalUnits);
  }
  const unabsorbedVerifiedCount = withInteractionsTotal(unabsorbed);
  const projectedDisplayCount = withInteractionsTotal({
    follows: input.canonicalDailyCount.follows + unabsorbed.follows,
    unfollows: input.canonicalDailyCount.unfollows + unabsorbed.unfollows,
    likes: input.canonicalDailyCount.likes + unabsorbed.likes,
    comments: input.canonicalDailyCount.comments + unabsorbed.comments,
    dms: input.canonicalDailyCount.dms + unabsorbed.dms,
    stories: input.canonicalDailyCount.stories + unabsorbed.stories,
  });
  return {
    ...projectedDisplayCount,
    source: "verified_progress+canonical_reconciliation",
    runId: input.runId,
    canonicalDailyCount: input.canonicalDailyCount,
    activeRunVerifiedCount,
    unabsorbedVerifiedCount,
    projectedDisplayCount,
    projectionSource: unabsorbedVerifiedCount.interactionsTotal > 0
      ? "active_run_verified_events"
      : "canonical_daily",
    lastProgressAt: lastVerifiedInteractionAt(scopedEvents),
  };
}

export function reconcileSocialCounters(...sources: ProfileSocialCounters[]): ProfileSocialCounters {
  const counters = blankSocialCounters();
  for (const source of sources) {
    counters.follows = Math.max(counters.follows, source.follows);
    counters.unfollows = Math.max(counters.unfollows, source.unfollows);
    counters.likes = Math.max(counters.likes, source.likes);
    counters.comments = Math.max(counters.comments, source.comments);
    counters.dms = Math.max(counters.dms, source.dms);
    counters.stories = Math.max(counters.stories, source.stories);
  }
  return withInteractionsTotal(counters);
}

export function dayKeyFromIso(value: unknown) {
  const date = new Date(readString(value, ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function interactionEventCountersByDay(eventRows: RecordValue[]) {
  const byDay = new Map<string, ProfileSocialCounters>();
  for (const row of eventRows) {
    const date = dayKeyFromIso(row.event_at ?? row.created_at);
    if (!date) continue;
    const current = byDay.get(date) ?? blankSocialCounters();
    const next = reconcileSocialCounters(current, interactionEventCounters([row]));
    byDay.set(date, next);
  }
  return byDay;
}

export function toStatsDaySocialCounters(counters: ProfileSocialCounters) {
  return {
    follow_count: counters.follows,
    unfollow_count: counters.unfollows,
    like_count: counters.likes,
    comment_count: counters.comments,
    dm_count: counters.dms,
    watch_count: counters.stories,
  };
}

export function reconcileStatsDaySocialCounters(
  ...sources: Array<ReturnType<typeof toStatsDaySocialCounters>>
) {
  const reconciled = reconcileSocialCounters(
    ...sources.map((source) => ({
      follows: source.follow_count,
      unfollows: source.unfollow_count,
      likes: source.like_count,
      comments: source.comment_count,
      dms: source.dm_count,
      stories: source.watch_count,
      interactionsTotal: 0,
    })),
  );
  return toStatsDaySocialCounters(reconciled);
}
