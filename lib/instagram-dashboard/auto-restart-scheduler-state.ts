import { isAutoRestartProductionExecutable } from "./auto-restart-mode.ts";

export type AutoRestartTickLockRow = {
  idempotency_key?: unknown;
  worker_id?: unknown;
  tick_started_at?: unknown;
  tick_completed_at?: unknown;
  status?: unknown;
  metadata_safe?: unknown;
};

export function readIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return trimmed;
}

export function resolveLatestCompletedTick(
  row: AutoRestartTickLockRow | null | undefined,
): { lastSchedulerCheck: string | null; lastTickStatus: string | null } {
  if (!row) {
    return { lastSchedulerCheck: null, lastTickStatus: null };
  }
  const status = String(row.status ?? "").trim().toLowerCase();
  const completedAt = readIsoTimestamp(row.tick_completed_at);
  if (status !== "completed" || !completedAt) {
    return { lastSchedulerCheck: null, lastTickStatus: status || null };
  }
  return {
    lastSchedulerCheck: completedAt,
    lastTickStatus: status,
  };
}

export function computeNextSchedulerCheck(input: {
  lastSchedulerCheck: string | null;
  checkEveryMinutes: number;
  enabled: boolean;
  mode: string;
}): string | null {
  if (!input.lastSchedulerCheck) return null;
  if (!isAutoRestartProductionExecutable(input.enabled, input.mode)) return null;
  const lastMs = Date.parse(input.lastSchedulerCheck);
  if (!Number.isFinite(lastMs)) return null;
  const intervalMs = Math.max(1, input.checkEveryMinutes) * 60_000;
  return new Date(lastMs + intervalMs).toISOString();
}

export function resolveSchedulerCheckState(input: {
  latestCompletedTick: AutoRestartTickLockRow | null | undefined;
  checkEveryMinutes: number;
  enabled: boolean;
  mode: string;
}): {
  lastSchedulerCheck: string | null;
  lastTickStatus: string | null;
  nextSchedulerCheck: string | null;
} {
  const latest = resolveLatestCompletedTick(input.latestCompletedTick);
  return {
    ...latest,
    nextSchedulerCheck: computeNextSchedulerCheck({
      lastSchedulerCheck: latest.lastSchedulerCheck,
      checkEveryMinutes: input.checkEveryMinutes,
      enabled: input.enabled,
      mode: input.mode,
    }),
  };
}
