import {
  verifySingleTargetUsername,
  pendingTargetVerificationDecision,
  type TargetVerificationDecision,
  type BulkTargetLine,
} from "../instagram-targets.ts";

export type TargetProviderEnrichmentResult = {
  line: BulkTargetLine;
  decision: TargetVerificationDecision;
  avatarResolved: boolean;
  avatarStatus: "resolved" | "unavailable";
};

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) return [] as R[];
  const boundedLimit = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: boundedLimit }, () => runWorker()));
  return results;
}

export async function enrichBulkTargetLinesWithProvider(
  lines: BulkTargetLine[],
  concurrency = 3,
): Promise<TargetProviderEnrichmentResult[]> {
  return mapWithConcurrency(lines, concurrency, async (line) => {
    try {
      const decision = await verifySingleTargetUsername(line.normalized_username);
      const avatarResolved = Boolean(decision.avatar_url);
      return {
        line,
        decision,
        avatarResolved,
        avatarStatus: avatarResolved ? "resolved" as const : "unavailable" as const,
      };
    } catch {
      const decision = pendingTargetVerificationDecision("provider_enrichment_failed");
      return {
        line,
        decision,
        avatarResolved: false,
        avatarStatus: "unavailable" as const,
      };
    }
  });
}
