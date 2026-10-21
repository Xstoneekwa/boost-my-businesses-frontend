import type Stripe from "stripe";

export type StripeProrationLine = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  proration: boolean;
  subscriptionId: string | null;
};

export type StripePlanChangeFinancialActual = {
  source: "pending_invoice_items" | "finalized_invoice" | "customer_balance";
  currency: "EUR";
  amountDueCents: number;
  remainingCreditCents: number;
  signedProrationNetCents: number;
  sourceObjectIds: string[];
  reconciledAt: string;
};

export function stripeCreditSnapshotMatchesQuote(
  quotedCreditCents: number,
  actual: StripePlanChangeFinancialActual | null,
): boolean {
  return Number.isInteger(quotedCreditCents)
    && quotedCreditCents >= 0
    && actual !== null
    && actual.remainingCreditCents === quotedCreditCents;
}

const EVENT_CORRELATION_TOLERANCE_SECONDS = 5 * 60;

function normalizeCurrency(value: string) {
  return value.trim().toLowerCase();
}

function summarizeSignedProration(
  source: StripePlanChangeFinancialActual["source"],
  lines: StripeProrationLine[],
  reconciledAt: string,
): StripePlanChangeFinancialActual | null {
  const canonical = lines.filter((line) => line.proration && normalizeCurrency(line.currency) === "eur");
  if (canonical.length === 0) return null;
  const signedProrationNetCents = canonical.reduce((sum, line) => sum + Math.trunc(line.amount), 0);
  return {
    source,
    currency: "EUR",
    amountDueCents: Math.max(0, signedProrationNetCents),
    remainingCreditCents: Math.max(0, -signedProrationNetCents),
    signedProrationNetCents,
    sourceObjectIds: canonical.map((line) => line.id).sort(),
    reconciledAt,
  };
}

function eventCorrelatedLines(
  lines: StripeProrationLine[],
  input: { stripeSubscriptionId: string; mutationUnix: number },
) {
  const candidates = lines.filter((line) => {
    if (!line.proration || normalizeCurrency(line.currency) !== "eur") return false;
    if (line.subscriptionId !== input.stripeSubscriptionId) return false;
    return Math.abs(line.created - input.mutationUnix) <= EVENT_CORRELATION_TOLERANCE_SECONDS;
  });
  if (candidates.length === 0) return [];

  // Stripe creates both sides of one proration at the same second. Selecting one
  // timestamp group prevents a previous plan change from leaking into this result.
  const closestCreated = candidates
    .map((line) => line.created)
    .sort((left, right) => Math.abs(left - input.mutationUnix) - Math.abs(right - input.mutationUnix))[0];
  return candidates.filter((line) => line.created === closestCreated);
}

function canonicalPendingLines(
  lines: StripeProrationLine[],
  input: { stripeSubscriptionId: string; mutationUnix: number },
) {
  const currentOperation = eventCorrelatedLines(lines, input);
  if (currentOperation.length === 0) return [];
  // Pending items are Stripe's complete not-yet-invoiced economic state. Keep
  // earlier pending prorations for the same subscription so successive plan
  // changes consume the existing credit instead of losing or duplicating it.
  return lines.filter((line) => (
    line.proration
    && normalizeCurrency(line.currency) === "eur"
    && line.subscriptionId === input.stripeSubscriptionId
  ));
}

function currentPendingLines(
  lines: StripeProrationLine[],
  input: { stripeSubscriptionId: string },
) {
  return lines.filter((line) => (
    line.proration
    && normalizeCurrency(line.currency) === "eur"
    && line.subscriptionId === input.stripeSubscriptionId
  ));
}

export function resolveStripePlanChangeFinancialActual(input: {
  stripeSubscriptionId: string;
  mutationUnix: number;
  snapshotMode?: "mutation_actual" | "current_credit";
  pendingInvoiceItems?: StripeProrationLine[];
  finalizedInvoiceLines?: StripeProrationLine[];
  customerBalanceBeforeCents?: number | null;
  customerBalanceAfterCents?: number | null;
  reconciledAt?: string;
}): StripePlanChangeFinancialActual | null {
  const reconciledAt = input.reconciledAt ?? new Date().toISOString();
  const pending = input.snapshotMode === "current_credit"
    ? currentPendingLines(input.pendingInvoiceItems ?? [], input)
    : canonicalPendingLines(input.pendingInvoiceItems ?? [], input);
  const pendingActual = summarizeSignedProration("pending_invoice_items", pending, reconciledAt);
  if (pendingActual) return pendingActual;

  const finalized = eventCorrelatedLines(input.finalizedInvoiceLines ?? [], input);
  const finalizedActual = summarizeSignedProration("finalized_invoice", finalized, reconciledAt);
  if (finalizedActual) return finalizedActual;

  const before = input.customerBalanceBeforeCents;
  const after = input.customerBalanceAfterCents;
  if (input.snapshotMode === "current_credit" && Number.isFinite(after)) {
    const signedBalance = Math.trunc(Number(after));
    return {
      source: "customer_balance",
      currency: "EUR",
      amountDueCents: Math.max(0, signedBalance),
      remainingCreditCents: Math.max(0, -signedBalance),
      signedProrationNetCents: signedBalance,
      sourceObjectIds: [],
      reconciledAt,
    };
  }
  if (Number.isFinite(before) && Number.isFinite(after)) {
    const signedDelta = Math.trunc(Number(after)) - Math.trunc(Number(before));
    if (signedDelta !== 0) {
      return {
        source: "customer_balance",
        currency: "EUR",
        amountDueCents: Math.max(0, signedDelta),
        remainingCreditCents: Math.max(0, -signedDelta),
        signedProrationNetCents: signedDelta,
        sourceObjectIds: [],
        reconciledAt,
      };
    }
  }
  return null;
}

function subscriptionId(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

function toPendingLine(item: Stripe.InvoiceItem): StripeProrationLine {
  return {
    id: item.id,
    amount: item.amount,
    currency: item.currency,
    created: item.date,
    proration: item.proration,
    subscriptionId: subscriptionId(item.subscription),
  };
}

function toInvoiceLine(line: Stripe.InvoiceLineItem, invoiceCreated: number): StripeProrationLine {
  return {
    id: line.id,
    amount: line.amount,
    currency: line.currency,
    created: line.period?.start ?? invoiceCreated,
    proration: line.proration,
    subscriptionId: subscriptionId(line.subscription),
  };
}

export async function collectStripePlanChangeFinancialActual(
  stripe: Stripe,
  input: {
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    mutationUnix: number;
    customerBalanceBeforeCents?: number | null;
    snapshotMode?: "mutation_actual" | "current_credit";
  },
) {
  const [pending, invoices, customer] = await Promise.all([
    stripe.invoiceItems.list({ customer: input.stripeCustomerId, pending: true, limit: 100 }),
    stripe.invoices.list({
      customer: input.stripeCustomerId,
      subscription: input.stripeSubscriptionId,
      created: { gte: input.mutationUnix - EVENT_CORRELATION_TOLERANCE_SECONDS },
      limit: 10,
    }),
    stripe.customers.retrieve(input.stripeCustomerId),
  ]);

  const finalizedInvoiceLines = invoices.data.flatMap((invoice) =>
    invoice.lines.data.map((line) => toInvoiceLine(line, invoice.created)),
  );
  const customerBalanceAfterCents = !customer.deleted ? customer.balance : null;

  return resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: input.stripeSubscriptionId,
    mutationUnix: input.mutationUnix,
    pendingInvoiceItems: pending.data.map(toPendingLine),
    finalizedInvoiceLines,
    customerBalanceBeforeCents: input.customerBalanceBeforeCents,
    customerBalanceAfterCents,
    snapshotMode: input.snapshotMode,
  });
}
