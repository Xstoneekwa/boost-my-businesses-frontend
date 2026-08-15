export function boundedCommercialConcurrency(value: unknown, fallback = 3) {
  const parsed = Number(value);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, 1), 5);
}

export function boundedCommercialBatchSize(value: unknown, fallback = 5) {
  const parsed = Number(value);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, 1), 5);
}

export async function mapWithBoundedConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>) {
  const results = new Array<R>(values.length); let cursor = 0;
  const workers = Array.from({ length: Math.min(boundedCommercialConcurrency(concurrency), values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; results[index] = await mapper(values[index], index); }
  });
  await Promise.all(workers); return results;
}

export function nextCommercialAttemptAt(now: Date, attemptCount: number) {
  const minutes = Math.min(30, 2 ** Math.max(0, attemptCount - 1));
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function planCommercialBatch<T>(claimable: T[], batchSize: unknown = 5) {
  return claimable.slice(0, boundedCommercialBatchSize(batchSize));
}
