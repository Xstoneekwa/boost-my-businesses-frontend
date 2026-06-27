import { normalizeCommunicationEmail } from "./client-communication-email.ts";

const POSTMARK_SENDERS_API_URL = "https://api.postmarkapp.com/senders";
export const POSTMARK_SENDER_REFRESH_MAX_AGE_MS = 15 * 60 * 1000;

export type PostmarkSenderIdentity = {
  email: string;
  name: string | null;
  confirmed: boolean;
};

export type PostmarkSenderSyncResult =
  | {
    ok: true;
    refreshedAt: string;
    identities: PostmarkSenderIdentity[];
    confirmedIdentities: PostmarkSenderIdentity[];
  }
  | {
    ok: false;
    reason: "account_token_missing" | "provider_error";
    message: string;
  };

type SenderSyncCache = {
  refreshedAt: string;
  identities: PostmarkSenderIdentity[];
};

let senderSyncCache: SenderSyncCache | null = null;

export function readPostmarkAccountTokenConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.POSTMARK_ACCOUNT_TOKEN?.trim());
}

export function getCachedPostmarkSenderSync(): SenderSyncCache | null {
  return senderSyncCache;
}

export function clearPostmarkSenderSyncCacheForTests() {
  senderSyncCache = null;
}

export function isPostmarkSenderRefreshRecent(
  refreshedAt: string | null | undefined,
  nowMs = Date.now(),
  maxAgeMs = POSTMARK_SENDER_REFRESH_MAX_AGE_MS,
): boolean {
  if (!refreshedAt) return false;
  const parsed = Date.parse(refreshedAt);
  if (!Number.isFinite(parsed)) return false;
  return nowMs - parsed <= maxAgeMs;
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function projectSenderIdentity(row: Record<string, unknown>): PostmarkSenderIdentity | null {
  const email = normalizeCommunicationEmail(readString(row.EmailAddress, ""));
  if (!email) return null;
  const name = readString(row.Name, "") || null;
  const confirmed = row.Confirmed === true;
  return { email, name, confirmed };
}

export async function refreshPostmarkSenderIdentities(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<PostmarkSenderSyncResult> {
  const accountToken = env.POSTMARK_ACCOUNT_TOKEN?.trim() ?? "";
  if (!accountToken) {
    return {
      ok: false,
      reason: "account_token_missing",
      message: "Sender identity sync is not configured.",
    };
  }

  const response = await fetcher(POSTMARK_SENDERS_API_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Postmark-Account-Token": accountToken,
    },
  });

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = readString(payload?.Message, "") || "Postmark sender sync failed.";
    return { ok: false, reason: "provider_error", message };
  }

  const senders = Array.isArray(payload?.Senders) ? payload!.Senders as Record<string, unknown>[] : [];
  const identities = senders
    .map((row) => projectSenderIdentity(row))
    .filter((row): row is PostmarkSenderIdentity => Boolean(row));

  const refreshedAt = new Date().toISOString();
  senderSyncCache = { refreshedAt, identities };

  return {
    ok: true,
    refreshedAt,
    identities,
    confirmedIdentities: identities.filter((row) => row.confirmed),
  };
}

export function findConfirmedPostmarkSenderIdentity(
  email: string,
  cache: SenderSyncCache | null = senderSyncCache,
): PostmarkSenderIdentity | null {
  const normalized = normalizeCommunicationEmail(email);
  if (!normalized || !cache) return null;
  return cache.identities.find((row) => row.email === normalized && row.confirmed) ?? null;
}

export function projectPostmarkSenderSyncStatus(input: {
  accountTokenConfigured: boolean;
  cache?: SenderSyncCache | null;
  nowMs?: number;
}) {
  const cache = input.cache ?? senderSyncCache;
  if (!input.accountTokenConfigured) {
    return {
      status: "not_configured" as const,
      message: "Sender identity sync is not configured.",
      lastRefreshedAt: null as string | null,
      confirmedSenders: [] as Array<{ email: string; name: string | null }>,
    };
  }

  if (!cache) {
    return {
      status: "not_refreshed" as const,
      message: "Refresh sender identities to load confirmed Postmark senders.",
      lastRefreshedAt: null as string | null,
      confirmedSenders: [] as Array<{ email: string; name: string | null }>,
    };
  }

  const confirmedSenders = cache.identities
    .filter((row) => row.confirmed)
    .map((row) => ({ email: row.email, name: row.name }));

  if (confirmedSenders.length === 0) {
    return {
      status: "no_confirmed_senders" as const,
      message: "No confirmed sender identities found.",
      lastRefreshedAt: cache.refreshedAt,
      confirmedSenders,
    };
  }

  const recent = isPostmarkSenderRefreshRecent(cache.refreshedAt, input.nowMs);
  return {
    status: recent ? "ready" as const : "stale" as const,
    message: recent
      ? "Confirmed sender identities are available."
      : "Sender identities are stale. Refresh before changing the active sender.",
    lastRefreshedAt: cache.refreshedAt,
    confirmedSenders,
  };
}
