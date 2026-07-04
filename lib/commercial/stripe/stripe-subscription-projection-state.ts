/**
 * Canonical Stripe subscription projection state rules.
 *
 * Priority (documented contract):
 * 1. Terminal subscription events (deleted/canceled) always win when present.
 * 2. Lifecycle signals apply in received_at order with anti-downgrade:
 *    incomplete must never overwrite trialing/active already confirmed.
 * 3. Degraded states (past_due, paused, unpaid) apply when emitted — they reflect
 *    real billing drift, not stale pre-checkout noise.
 * 4. When checkout attempt is fulfilled AND invoice.paid exists for the customer,
 *    a remaining lone `incomplete` signal is treated as pre-payment stale state
 *    and floored to `active` only if no stronger terminal/degraded signal exists.
 *    This is not an arbitrary “checkout paid => active” shortcut.
 */

export const STRIPE_SUBSCRIPTION_TERMINAL_STATUSES = new Set([
  "canceled",
  "cancelled",
  "unpaid",
  "incomplete_expired",
]);

export const STRIPE_SUBSCRIPTION_DEGRADED_STATUSES = new Set([
  "past_due",
  "paused",
]);

const LIFECYCLE_RANK: Record<string, number> = {
  incomplete: 0,
  trialing: 1,
  active: 2,
};

export type StripeSubscriptionStatusSignal = {
  status: string;
  receivedAtMs: number;
  source: string;
  isTerminalEvent?: boolean;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function lifecycleRank(status: string) {
  return LIFECYCLE_RANK[readString(status)] ?? -1;
}

export function shouldApplySubscriptionStatus(
  existingStatus: string | null | undefined,
  incomingStatus: string,
  options?: { incomingIsTerminalEvent?: boolean },
) {
  const existing = readString(existingStatus);
  const incoming = readString(incomingStatus, "incomplete");
  if (!existing || existing === incoming) return true;

  if (options?.incomingIsTerminalEvent || STRIPE_SUBSCRIPTION_TERMINAL_STATUSES.has(incoming)) {
    return true;
  }

  if (STRIPE_SUBSCRIPTION_TERMINAL_STATUSES.has(existing)) {
    return false;
  }

  if (STRIPE_SUBSCRIPTION_DEGRADED_STATUSES.has(incoming)) {
    return true;
  }

  const existingRank = lifecycleRank(existing);
  const incomingRank = lifecycleRank(incoming);
  if (existingRank >= 0 && incomingRank >= 0) {
    return incomingRank >= existingRank;
  }

  if (incoming === "incomplete" && existingRank >= lifecycleRank("trialing")) {
    return false;
  }

  return incomingRank >= existingRank;
}

export function resolveCanonicalSubscriptionStatus(
  signals: StripeSubscriptionStatusSignal[],
  options?: { checkoutFulfilled?: boolean; invoicePaid?: boolean },
) {
  if (!signals.length) {
    if (options?.checkoutFulfilled && options?.invoicePaid) return "active";
    return "incomplete";
  }

  const sorted = [...signals].sort((left, right) => left.receivedAtMs - right.receivedAtMs);
  let canonical = readString(sorted[0]?.status, "incomplete");

  for (const signal of sorted.slice(1)) {
    if (shouldApplySubscriptionStatus(canonical, signal.status, {
      incomingIsTerminalEvent: signal.isTerminalEvent,
    })) {
      canonical = signal.status;
    }
  }

  const hasTerminal = sorted.some((signal) => STRIPE_SUBSCRIPTION_TERMINAL_STATUSES.has(signal.status));
  const hasDegraded = sorted.some((signal) => STRIPE_SUBSCRIPTION_DEGRADED_STATUSES.has(signal.status));
  if (
    options?.checkoutFulfilled
    && options?.invoicePaid
    && canonical === "incomplete"
    && !hasTerminal
    && !hasDegraded
  ) {
    canonical = "active";
  }

  return canonical;
}

export function pickLatestSubscriptionSnapshot<T extends {
  current_period_start?: number | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  stripe_price_id?: string | null;
}>(snapshots: T[]) {
  return snapshots.at(-1) ?? null;
}
