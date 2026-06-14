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

export function actionCountersFromLogs(logRows: RecordValue[]): ProfileSocialCounters {
  const counters = blankSocialCounters();
  for (const row of logRows) {
    if (!shouldCountSocialLog(row)) continue;
    const kind = socialActionKindFromLog(readString(row.action_type, ""));
    if (kind) counters[kind] += 1;
  }
  return withInteractionsTotal(counters);
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

export function interactionEventCounters(eventRows: RecordValue[]): ProfileSocialCounters {
  const counters = blankSocialCounters();
  for (const row of eventRows) {
    if (!shouldCountInteractionEvent(row)) continue;
    const eventType = readString(row.event_type, "").toLowerCase();
    const interactionType = readString(row.interaction_type, "").toLowerCase();
    if (eventType === "post_like_success" || interactionType === "like" || eventType.includes("post_like")) {
      counters.likes += likedCountFromInteractionEvent(row);
    }
  }
  return withInteractionsTotal(counters);
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
