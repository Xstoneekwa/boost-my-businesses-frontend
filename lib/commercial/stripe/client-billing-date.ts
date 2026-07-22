import type { ClientBillingLang } from "./client-billing-types.ts";

export type ClientBillingDateKind =
  | "next_payment"
  | "subscription_end"
  | "payment_issue"
  | "unavailable";

export type ClientBillingDateSource =
  | "stripe_upcoming_invoice"
  | "stripe_subscription_period"
  | "stripe_projection"
  | "none";

export type ClientBillingDate = {
  kind: ClientBillingDateKind;
  dateIso: string | null;
  label: string;
  valueLabel: string;
  source: ClientBillingDateSource;
};

function readIso(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatClientBillingDate(value: string, lang: ClientBillingLang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function copy(kind: ClientBillingDateKind, lang: ClientBillingLang) {
  if (kind === "next_payment") {
    return lang === "fr"
      ? { label: "Prochain prélèvement", valueLabel: "" }
      : { label: "Next payment", valueLabel: "" };
  }
  if (kind === "subscription_end") {
    return lang === "fr"
      ? { label: "Fin de l'abonnement", valueLabel: "Abonnement annulé" }
      : { label: "Subscription end", valueLabel: "Subscription canceled" };
  }
  if (kind === "payment_issue") {
    return lang === "fr"
      ? { label: "Paiement à régulariser", valueLabel: "Action requise" }
      : { label: "Payment issue", valueLabel: "Action required" };
  }
  return lang === "fr"
    ? { label: "Prochain prélèvement", valueLabel: "Date indisponible" }
    : { label: "Next payment", valueLabel: "Date unavailable" };
}

export function resolveClientBillingDate(input: {
  lang: ClientBillingLang;
  status?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  canceledAt?: string | null;
  endedAt?: string | null;
  upcomingInvoiceDate?: string | null;
  stripePeriodEnd?: string | null;
  projectedPeriodEnd?: string | null;
}): ClientBillingDate {
  const status = String(input.status || "").trim().toLowerCase();
  const upcomingInvoiceDate = readIso(input.upcomingInvoiceDate);
  const stripePeriodEnd = readIso(input.stripePeriodEnd);
  const projectedPeriodEnd = readIso(input.projectedPeriodEnd);
  const periodEnd = stripePeriodEnd || projectedPeriodEnd;
  const periodSource: ClientBillingDateSource = stripePeriodEnd
    ? "stripe_subscription_period"
    : projectedPeriodEnd
      ? "stripe_projection"
      : "none";

  if (input.cancelAtPeriodEnd || ["canceled", "cancelled"].includes(status)) {
    const endedAt = readIso(input.endedAt);
    const dateIso = endedAt || periodEnd;
    const labels = copy("subscription_end", input.lang);
    return {
      kind: "subscription_end",
      dateIso,
      label: labels.label,
      valueLabel: dateIso ? "" : labels.valueLabel,
      source: endedAt ? "stripe_subscription_period" : (dateIso ? periodSource : "none"),
    };
  }

  if (["past_due", "unpaid"].includes(status)) {
    const labels = copy("payment_issue", input.lang);
    return { kind: "payment_issue", dateIso: null, ...labels, source: "none" };
  }

  if (["active", "trialing"].includes(status)) {
    const dateIso = upcomingInvoiceDate || periodEnd;
    if (dateIso) {
      const labels = copy("next_payment", input.lang);
      return {
        kind: "next_payment",
        dateIso,
        label: labels.label,
        valueLabel: "",
        source: upcomingInvoiceDate ? "stripe_upcoming_invoice" : periodSource,
      };
    }
  }

  const labels = copy("unavailable", input.lang);
  return { kind: "unavailable", dateIso: null, ...labels, source: "none" };
}
