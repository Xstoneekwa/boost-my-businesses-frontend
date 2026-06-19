import { readString } from "./guards.ts";

type Lang = "fr" | "en";
type SafeRecord = Record<string, unknown>;

export type ClientActivityLang = Lang;

export type ClientActivityQuery = {
  search?: string;
  period?: "7d" | "30d" | "90d";
  action?: string;
  result?: string;
  cursor?: string;
  limit?: number;
  lang?: ClientActivityLang;
};

export type ClientActivityItem = {
  occurredAt: string;
  instagramAccount: string | null;
  targetAccount: string | null;
  touchedAccount: string | null;
  actionLabel: string;
  resultLabel: string;
  detailLabel: string | null;
};

export type ClientActivityPage = {
  items: ClientActivityItem[];
  nextCursor: string | null;
};

export type InternalActivityRow = ClientActivityItem & {
  sortKey: string;
  actionKey: string;
  resultKey: string;
};

const FORBIDDEN_CLIENT_ACTIVITY_TERMS = [
  "run_id",
  "worker",
  "dispatcher",
  "botapp",
  "target_id",
  "ig_targets",
  "searchapi",
  "serp",
  "provider",
  "verification job",
  "backend",
  "supabase",
  "evidence",
  "stack trace",
  "error stack",
  "metadata_safe",
  "exit_code",
  "session_id",
  "device_id",
  "request_id",
];

const HIDDEN_INTERACTION_EVENT_TYPES = new Set([
  "follow_verified",
  "target_selected",
  "target_budget_reached",
  "follow_requested",
]);

function normalizeUsername(value: unknown) {
  const raw = readString(value, "").trim().replace(/^@+/, "");
  return raw ? `@${raw}` : null;
}

function readLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
}

function readMetadataNumber(metadata: SafeRecord | null | undefined, key: string) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(readString(value, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function clientActivityActionLabel(
  input: { eventType?: string; operation?: string; interactionType?: string | null },
  lang: Lang = "fr",
): { label: string; key: string } {
  const eventType = readString(input.eventType, "").toLowerCase();
  const operation = readString(input.operation, "").toLowerCase();
  const interactionType = readString(input.interactionType, "").toLowerCase();
  const source = eventType || operation || interactionType;

  const fr: Record<string, string> = {
    follow_sent: "Compte suivi",
    follow: "Compte suivi",
    unfollow_sent: "Abonnement retiré",
    unfollow: "Abonnement retiré",
    like_sent: "Publication aimée",
    post_like_success: "Publication aimée",
    like: "Publication aimée",
    story_viewed: "Story consultée",
    story_view: "Story consultée",
    dm_sent: "Message envoyé",
    dm: "Message envoyé",
    mute_success: "Compte mis en sourdine",
    target_add_single: "Compte cible ajouté",
    target_add_bulk: "Comptes cibles ajoutés",
    target_archive: "Compte cible retiré",
    target_restore: "Compte cible restauré",
    target_reset: "Compte cible réinitialisé",
    target_verify: "Compte cible vérifié",
    target_quality_decision: "Décision sur compte cible",
    target_runtime_error_non_exhaustion: "Action campagne",
    profile_visit: "Profil consulté",
  };

  const en: Record<string, string> = {
    follow_sent: "Account followed",
    follow: "Account followed",
    unfollow_sent: "Unfollowed",
    unfollow: "Unfollowed",
    like_sent: "Post liked",
    post_like_success: "Post liked",
    like: "Post liked",
    story_viewed: "Story viewed",
    story_view: "Story viewed",
    dm_sent: "Message sent",
    dm: "Message sent",
    mute_success: "Account muted",
    target_add_single: "Target account added",
    target_add_bulk: "Target accounts added",
    target_archive: "Target account removed",
    target_restore: "Target account restored",
    target_reset: "Target account reset",
    target_verify: "Target account verified",
    target_quality_decision: "Target account decision",
    target_runtime_error_non_exhaustion: "Campaign action",
    profile_visit: "Profile visited",
  };

  const labels = lang === "en" ? en : fr;
  if (labels[source]) return { label: labels[source], key: source };
  if (source.includes("follow")) return { label: labels.follow_sent, key: "follow_sent" };
  if (source.includes("like")) return { label: labels.like_sent, key: "like_sent" };
  if (source.includes("story")) return { label: labels.story_viewed, key: "story_viewed" };
  if (source.includes("dm")) return { label: labels.dm_sent, key: "dm_sent" };
  if (source.startsWith("target_add")) return { label: labels.target_add_single, key: "target_add_single" };
  if (source.startsWith("target_archive")) return { label: labels.target_archive, key: "target_archive" };
  return { label: lang === "en" ? "Campaign activity" : "Activité campagne", key: "campaign_activity" };
}

export function clientActivityResultLabel(
  input: { status?: string; result?: string },
  lang: Lang = "fr",
): { label: string; key: string } {
  const raw = readString(input.status || input.result, "").toLowerCase();
  const fr: Record<string, string> = {
    success: "Réussi",
    succeeded: "Réussi",
    accepted: "Réussi",
    archived: "Réussi",
    restored: "Réussi",
    skipped: "Non effectué",
    duplicate: "Non effectué",
    rejected: "Non effectué",
    failed: "Échec",
    pending: "En attente",
    review: "En attente",
  };
  const en: Record<string, string> = {
    success: "Successful",
    succeeded: "Successful",
    accepted: "Successful",
    archived: "Successful",
    restored: "Successful",
    skipped: "Not performed",
    duplicate: "Not performed",
    rejected: "Not performed",
    failed: "Failed",
    pending: "Pending",
    review: "Pending",
  };
  const keyMap: Record<string, string> = {
    success: "success",
    succeeded: "success",
    accepted: "success",
    archived: "success",
    restored: "success",
    skipped: "skipped",
    duplicate: "skipped",
    rejected: "skipped",
    failed: "failed",
    pending: "pending",
    review: "pending",
  };
  const labels = lang === "en" ? en : fr;
  const key = keyMap[raw] ?? "unknown";
  return { label: labels[raw] ?? (lang === "en" ? "Unknown" : "Inconnu"), key };
}

export function clientActivityDetailLabel(
  input: {
    reason?: string | null;
    eventType?: string;
    operation?: string;
    metadata?: SafeRecord | null;
    lang?: Lang;
  },
): string | null {
  const lang = input.lang ?? "fr";
  const reason = readString(input.reason, "").toLowerCase();
  const operation = readString(input.operation, "").toLowerCase();
  const eventType = readString(input.eventType, "").toLowerCase();

  const frReasons: Record<string, string> = {
    followers_count_below_minimum: "Trop peu d'abonnés",
    profile_is_verified: "Compte certifié",
    out_of_location: "Hors localisation",
    rejected_out_of_location: "Hors localisation",
    not_relevant: "Profil non pertinent",
    rejected_not_relevant: "Profil non pertinent",
    profile_not_accessible: "Profil non accessible",
    duplicate: "Compte déjà présent",
    found: "Compte ajouté à votre campagne",
    bulk_import_classified: "Import terminé",
  };
  const enReasons: Record<string, string> = {
    followers_count_below_minimum: "Too few followers",
    profile_is_verified: "Verified account",
    out_of_location: "Outside location",
    rejected_out_of_location: "Outside location",
    not_relevant: "Profile not relevant",
    rejected_not_relevant: "Profile not relevant",
    profile_not_accessible: "Profile not accessible",
    duplicate: "Account already listed",
    found: "Account added to your campaign",
    bulk_import_classified: "Import completed",
  };
  const reasonLabels = lang === "en" ? enReasons : frReasons;
  if (reasonLabels[reason]) return reasonLabels[reason];

  if (operation === "target_add_bulk") {
    const accepted = readMetadataNumber(input.metadata ?? null, "accepted_for_verification")
      ?? readMetadataNumber(input.metadata ?? null, "total_submitted");
    if (accepted && accepted > 0) {
      return lang === "en"
        ? `${accepted} target account${accepted > 1 ? "s" : ""} added`
        : `${accepted} compte${accepted > 1 ? "s" : ""} cible${accepted > 1 ? "s" : ""} ajouté${accepted > 1 ? "s" : ""}`;
    }
  }

  if (eventType === "target_runtime_error_non_exhaustion") {
    return lang === "en" ? "Action could not be completed on this target account." : "Action non réalisée sur ce compte cible.";
  }

  return null;
}

function readPayloadBoolean(payload: SafeRecord | null | undefined, key: string) {
  if (!payload || typeof payload !== "object") return false;
  const value = payload[key];
  if (typeof value === "boolean") return value;
  return readString(value, "").toLowerCase() === "true";
}

export function clientActivityMuteDetailLabel(
  payload: SafeRecord | null | undefined,
  lang: Lang = "fr",
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const mutedPosts = readPayloadBoolean(payload, "muted_posts");
  const mutedStories = readPayloadBoolean(payload, "muted_stories");
  const mutePartial = readPayloadBoolean(payload, "mute_partial");

  if (mutedPosts && mutedStories) {
    return lang === "en" ? "Posts and stories hidden" : "Publications et stories masquées";
  }
  if (mutedPosts) {
    return lang === "en" ? "Posts hidden" : "Publications masquées";
  }
  if (mutedStories) {
    return lang === "en" ? "Stories hidden" : "Stories masquées";
  }
  if (mutePartial) {
    return lang === "en" ? "Partial mute applied" : "Mise en sourdine partielle";
  }
  return null;
}

export function normalizeClientActivitySearch(value: unknown) {
  return readString(value, "").trim().replace(/^@+/, "").toLowerCase();
}

export function filterClientActivityItems(
  items: InternalActivityRow[],
  query: Pick<ClientActivityQuery, "search" | "action" | "result">,
) {
  const term = normalizeClientActivitySearch(query.search);
  const actionFilter = readString(query.action, "").trim().toLowerCase();
  const resultFilter = readString(query.result, "").trim().toLowerCase();

  return items.filter((item) => {
    if (actionFilter && actionFilter !== "all" && item.actionKey !== actionFilter) return false;
    if (resultFilter && resultFilter !== "all" && item.resultKey !== resultFilter) return false;
    if (!term) return true;
    const haystack = [
      item.instagramAccount,
      item.targetAccount,
      item.touchedAccount,
      item.actionLabel,
      item.resultLabel,
      item.detailLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

export function encodeClientActivityCursor(sortKey: string) {
  return Buffer.from(sortKey, "utf8").toString("base64url");
}

export function decodeClientActivityCursor(value: string | null | undefined) {
  const raw = readString(value, "");
  if (!raw) return null;
  try {
    return Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function paginateClientActivityItems(items: InternalActivityRow[], query: Pick<ClientActivityQuery, "cursor" | "limit">) {
  const limit = readLimit(query.limit);
  const cursor = decodeClientActivityCursor(query.cursor);
  const sorted = [...items].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const filtered = cursor
    ? sorted.filter((item) => item.sortKey < cursor)
    : sorted;
  const page = filtered.slice(0, limit).map(({ sortKey: _sortKey, actionKey: _actionKey, resultKey: _resultKey, ...item }) => item);
  const next = filtered.length > limit ? filtered[limit - 1]?.sortKey ?? null : null;
  return {
    items: page,
    nextCursor: next ? encodeClientActivityCursor(next) : null,
  } satisfies ClientActivityPage;
}

export function mapClientInteractionEvent(
  row: SafeRecord,
  accountUsername: string | null,
  lang: Lang = "fr",
): InternalActivityRow | null {
  const eventType = readString(row.event_type, "").toLowerCase();
  if (HIDDEN_INTERACTION_EVENT_TYPES.has(eventType)) return null;

  const eventStatus = readString(row.event_status, "").toLowerCase();
  const interactionType = readString(row.interaction_type, "") || null;
  const { label: actionLabel, key: actionKey } = clientActivityActionLabel(
    { eventType, interactionType },
    lang,
  );
  const { label: resultLabel, key: resultKey } = clientActivityResultLabel({ status: eventStatus }, lang);
  const targetAccount = normalizeUsername(row.source_target_username);
  const touchedRaw = normalizeUsername(row.username);
  const instagramAccount = normalizeUsername(accountUsername);
  const touchedAccount = touchedRaw && touchedRaw !== targetAccount && touchedRaw !== instagramAccount
    ? touchedRaw
    : touchedRaw && targetAccount && touchedRaw !== targetAccount
      ? touchedRaw
      : null;

  const occurredAt = readString(row.event_at, "") || readString(row.created_at, "");
  const id = readString(row.id, "unknown");
  const payload = row.payload && typeof row.payload === "object"
    ? row.payload as SafeRecord
    : null;
  const detailLabel = eventType === "mute_success"
    ? clientActivityMuteDetailLabel(payload, lang)
    : clientActivityDetailLabel({
      reason: readString(row.event_reason, "") || null,
      eventType,
      lang,
    });

  return {
    occurredAt,
    instagramAccount,
    targetAccount,
    touchedAccount,
    actionLabel,
    resultLabel,
    detailLabel,
    sortKey: `${occurredAt}|interaction|${id}`,
    actionKey,
    resultKey,
  };
}

export function mapClientTargetAuditEvent(
  row: SafeRecord,
  accountUsername: string | null,
  targetUsername: string | null,
  lang: Lang = "fr",
): InternalActivityRow {
  const operation = readString(row.operation, "").toLowerCase();
  const result = readString(row.result, "").toLowerCase();
  const metadata = row.metadata_safe && typeof row.metadata_safe === "object"
    ? row.metadata_safe as SafeRecord
    : null;
  const { label: actionLabel, key: actionKey } = clientActivityActionLabel({ operation }, lang);
  const { label: resultLabel, key: resultKey } = clientActivityResultLabel({ result }, lang);
  const detailLabel = clientActivityDetailLabel({
    reason: readString(row.reason, "") || null,
    operation,
    metadata,
    lang,
  });
  const occurredAt = readString(row.created_at, "");
  const id = readString(row.id, "unknown");
  const targetAccount = normalizeUsername(targetUsername);

  return {
    occurredAt,
    instagramAccount: normalizeUsername(accountUsername),
    targetAccount,
    touchedAccount: null,
    actionLabel,
    resultLabel,
    detailLabel,
    sortKey: `${occurredAt}|audit|${id}`,
    actionKey,
    resultKey,
  };
}

export function collectForbiddenClientActivityTerms(payload: unknown) {
  const serialized = JSON.stringify(payload).toLowerCase();
  return FORBIDDEN_CLIENT_ACTIVITY_TERMS.filter((term) => serialized.includes(term.trim()));
}

const FORBIDDEN_AMBIGUOUS_CLIENT_LABELS = [
  "Compte ciblé",
  "Comptes ciblés",
  "Compte protégé",
];

export function collectForbiddenAmbiguousClientLabels(payload: unknown) {
  const serialized = JSON.stringify(payload);
  return FORBIDDEN_AMBIGUOUS_CLIENT_LABELS.filter((label) => serialized.includes(label));
}

export function clientActivityPeriodSince(period: ClientActivityQuery["period"]) {
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days + 1);
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}
