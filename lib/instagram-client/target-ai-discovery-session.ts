import { createHash } from "node:crypto";
import type { SerpProfileCandidate } from "./target-ai-serp-extractor.ts";
import type { TargetAiSearchCandidate } from "./target-ai-search-service.ts";

export type TargetAiDiscoverySession = {
  sessionId: string;
  accountId: string;
  niche: string;
  locationLabel: string | null;
  serpCandidates: SerpProfileCandidate[];
  candidates: TargetAiSearchCandidate[];
  createdAtMs: number;
  expiresAtMs: number;
};

const sessions = new Map<string, TargetAiDiscoverySession>();
const DEFAULT_TTL_MS = 20 * 60 * 1000;

function readTtlMs() {
  const raw = process.env.TARGET_AI_DISCOVERY_SESSION_TTL_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MS;
  return Math.min(Math.max(parsed, 5 * 60 * 1000), 30 * 60 * 1000);
}

function purgeExpiredSessions(now = Date.now()) {
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAtMs <= now) sessions.delete(key);
  }
}

export function buildTargetAiDiscoverySessionKey(input: {
  accountId: string;
  niche: string;
  locationLabel?: string | null;
}) {
  const payload = [
    input.accountId.trim(),
    input.niche.trim().toLowerCase(),
    (input.locationLabel || "").trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

export function getTargetAiDiscoverySession(sessionId: string) {
  purgeExpiredSessions();
  return sessions.get(sessionId) ?? null;
}

export function saveTargetAiDiscoverySession(input: Omit<TargetAiDiscoverySession, "createdAtMs" | "expiresAtMs">) {
  purgeExpiredSessions();
  const ttlMs = readTtlMs();
  const now = Date.now();
  const session: TargetAiDiscoverySession = {
    ...input,
    createdAtMs: now,
    expiresAtMs: now + ttlMs,
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function updateTargetAiDiscoverySessionCandidates(sessionId: string, candidates: TargetAiSearchCandidate[]) {
  const session = getTargetAiDiscoverySession(sessionId);
  if (!session) return null;
  session.candidates = candidates;
  sessions.set(sessionId, session);
  return session;
}

export function resetTargetAiDiscoverySessionsForTests() {
  sessions.clear();
}
