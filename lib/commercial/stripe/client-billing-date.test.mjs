import assert from "node:assert/strict";
import test from "node:test";
import {
  formatClientBillingDate,
  resolveClientBillingDate,
} from "./client-billing-date.ts";

const periodEnd = "2027-07-20T13:44:51.000Z";
const previewDate = "2027-07-20T14:44:51.000Z";

test("1 annual active subscription uses the live Stripe period end", () => {
  const result = resolveClientBillingDate({ lang: "fr", status: "active", stripePeriodEnd: periodEnd });
  assert.equal(result.kind, "next_payment");
  assert.equal(result.dateIso, periodEnd);
  assert.equal(result.source, "stripe_subscription_period");
});

test("2 upcoming invoice date has priority over the subscription period", () => {
  const result = resolveClientBillingDate({
    lang: "en",
    status: "active",
    upcomingInvoiceDate: previewDate,
    stripePeriodEnd: periodEnd,
  });
  assert.equal(result.dateIso, previewDate);
  assert.equal(result.source, "stripe_upcoming_invoice");
});

test("3 canonical projection is used only after live Stripe sources", () => {
  const result = resolveClientBillingDate({ lang: "fr", status: "active", projectedPeriodEnd: periodEnd });
  assert.equal(result.dateIso, periodEnd);
  assert.equal(result.source, "stripe_projection");
});

test("4 cancel_at_period_end displays subscription end", () => {
  const result = resolveClientBillingDate({ lang: "fr", status: "active", cancelAtPeriodEnd: true, stripePeriodEnd: periodEnd });
  assert.equal(result.kind, "subscription_end");
  assert.equal(result.label, "Fin de l'abonnement");
  assert.equal(result.dateIso, periodEnd);
});

test("5 canceled subscription is client safe when no access end exists", () => {
  const result = resolveClientBillingDate({ lang: "en", status: "canceled", canceledAt: "2026-07-21T00:00:00Z" });
  assert.equal(result.kind, "subscription_end");
  assert.equal(result.dateIso, null);
  assert.equal(result.valueLabel, "Subscription canceled");
});

test("6 past_due never presents a future debit date", () => {
  const result = resolveClientBillingDate({ lang: "fr", status: "past_due", stripePeriodEnd: periodEnd });
  assert.equal(result.kind, "payment_issue");
  assert.equal(result.dateIso, null);
  assert.equal(result.valueLabel, "Action requise");
});

test("7 unpaid never presents a future debit date", () => {
  const result = resolveClientBillingDate({ lang: "en", status: "unpaid", stripePeriodEnd: periodEnd });
  assert.equal(result.kind, "payment_issue");
  assert.equal(result.dateIso, null);
});

test("8 active subscription without a trusted date is explicit", () => {
  const result = resolveClientBillingDate({ lang: "fr", status: "active" });
  assert.equal(result.kind, "unavailable");
  assert.equal(result.valueLabel, "Date indisponible");
});

test("9 French active label is Prochain prélèvement", () => {
  assert.equal(resolveClientBillingDate({ lang: "fr", status: "active", stripePeriodEnd: periodEnd }).label, "Prochain prélèvement");
});

test("10 English active label is Next payment", () => {
  assert.equal(resolveClientBillingDate({ lang: "en", status: "active", stripePeriodEnd: periodEnd }).label, "Next payment");
});

test("11 French long date is localized", () => {
  assert.equal(formatClientBillingDate(periodEnd, "fr"), "20 juillet 2027");
});

test("12 English long date is localized", () => {
  assert.equal(formatClientBillingDate(periodEnd, "en"), "July 20, 2027");
});

test("13 invalid dates are rejected instead of guessed", () => {
  const result = resolveClientBillingDate({ lang: "fr", status: "active", stripePeriodEnd: "not-a-date" });
  assert.equal(result.kind, "unavailable");
  assert.equal(result.dateIso, null);
});

test("14 card expiry is outside the billing-date contract", () => {
  const result = resolveClientBillingDate({ lang: "fr", status: "active", stripePeriodEnd: periodEnd });
  assert.deepEqual(Object.keys(result).sort(), ["dateIso", "kind", "label", "source", "valueLabel"]);
});
