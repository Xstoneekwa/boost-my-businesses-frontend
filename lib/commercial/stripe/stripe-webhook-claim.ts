export const STRIPE_WEBHOOK_PROCESSING_STALE_MS = 120_000;

export type WebhookLedgerSnapshot = {
  status: string;
  processingStartedAtMs: number | null;
};

export type WebhookClaimDecision =
  | { action: "insert" }
  | { action: "deduplicated" }
  | { action: "claim" }
  | { action: "reclaim_stale" }
  | { action: "concurrent_retry" };

export function mapWebhookRpcClaimResult(result: string | null | undefined): WebhookClaimDecision["action"] | "unknown" {
  switch (result) {
    case "claimed":
      return "claim";
    case "deduplicated":
      return "deduplicated";
    case "concurrent":
      return "concurrent_retry";
    case "reclaimed_stale":
      return "reclaim_stale";
    default:
      return "unknown";
  }
}

export function resolveWebhookClaimDecision(
  existing: WebhookLedgerSnapshot | null,
  nowMs: number,
  staleAfterMs = STRIPE_WEBHOOK_PROCESSING_STALE_MS,
): WebhookClaimDecision {
  if (!existing) {
    return { action: "insert" };
  }

  if (existing.status === "processed" || existing.status === "ignored") {
    return { action: "deduplicated" };
  }

  if (existing.status === "processing") {
    const startedAt = existing.processingStartedAtMs;
    if (startedAt != null && nowMs - startedAt <= staleAfterMs) {
      return { action: "concurrent_retry" };
    }
    return { action: "reclaim_stale" };
  }

  if (existing.status === "failed" || existing.status === "retryable" || existing.status === "received") {
    return { action: "claim" };
  }

  return { action: "claim" };
}
