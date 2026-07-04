import type { ClientBillingLang, ClientInvoiceStatus } from "./client-billing-types.ts";

const COPY = {
  fr: {
    noPaymentMethod: "Aucun moyen de paiement enregistré",
    agencyDefaultScope: "Carte par défaut du compte agence",
    subscriptionScope: "Moyen de paiement de l'abonnement",
    invoicePaid: "Payé",
    invoiceOpen: "En attente",
    invoiceFailed: "Échoué",
    invoiceRefunded: "Remboursé",
    invoiceUnknown: "Statut indisponible",
    subscriptionActive: "Actif",
    subscriptionPastDue: "Paiement en retard",
    subscriptionCanceled: "Annulé",
    subscriptionIncomplete: "En cours d'activation",
    subscriptionOther: "Statut indisponible",
    monthlyCadence: "Mensuel",
    multiMonthCadence: "Tous les {{months}} mois",
    unassignedInvoicesTitle: "Factures non associées à un compte",
    agencyPaymentsTitle: "Paiements de l'agence",
    portalUnavailable: "La modification du moyen de paiement n'est pas disponible pour le moment. Contactez le support si le problème persiste.",
    billingUnavailable: "Les informations de facturation ne sont pas disponibles pour le moment.",
    loading: "Chargement…",
    noInvoices: "Aucune facture récente",
    nextBilling: "Prochaine échéance",
    globalNextBilling: "Prochaine échéance globale",
    updatePaymentMethod: "Modifier le moyen de paiement",
    invoicesTitle: "Factures récentes",
    viewInvoice: "Voir la facture",
    downloadPdf: "Télécharger le PDF",
    paymentMethodTitle: "Moyen de paiement",
    managePaymentDrawerTitle: "Gérer le paiement",
    accountInvoices: "Factures",
    outreachOnly: "Outreach",
    packageAndOutreach: "{{package}} + Outreach",
  },
  en: {
    noPaymentMethod: "No payment method on file",
    agencyDefaultScope: "Agency account default card",
    subscriptionScope: "Subscription payment method",
    invoicePaid: "Paid",
    invoiceOpen: "Pending",
    invoiceFailed: "Failed",
    invoiceRefunded: "Refunded",
    invoiceUnknown: "Status unavailable",
    subscriptionActive: "Active",
    subscriptionPastDue: "Past due",
    subscriptionCanceled: "Canceled",
    subscriptionIncomplete: "Activation pending",
    subscriptionOther: "Status unavailable",
    monthlyCadence: "Monthly",
    multiMonthCadence: "Every {{months}} months",
    unassignedInvoicesTitle: "Invoices not linked to an account",
    agencyPaymentsTitle: "Agency payments",
    portalUnavailable: "Payment method updates are unavailable right now. Contact support if this continues.",
    billingUnavailable: "Billing information is unavailable right now.",
    loading: "Loading…",
    noInvoices: "No recent invoices",
    nextBilling: "Next billing date",
    globalNextBilling: "Next overall billing date",
    updatePaymentMethod: "Update payment method",
    invoicesTitle: "Recent invoices",
    viewInvoice: "View invoice",
    downloadPdf: "Download PDF",
    paymentMethodTitle: "Payment method",
    managePaymentDrawerTitle: "Manage payment",
    accountInvoices: "Invoices",
    outreachOnly: "Outreach",
    packageAndOutreach: "{{package}} + Outreach",
  },
} as const;

export type ClientBillingCopy = typeof COPY.fr | typeof COPY.en;

export function clientBillingCopy(lang: ClientBillingLang): ClientBillingCopy {
  return COPY[lang];
}

export function invoiceStatusLabel(status: ClientInvoiceStatus, lang: ClientBillingLang) {
  const t = clientBillingCopy(lang);
  if (status === "paid") return t.invoicePaid;
  if (status === "open") return t.invoiceOpen;
  if (status === "failed") return t.invoiceFailed;
  if (status === "refunded") return t.invoiceRefunded;
  return t.invoiceUnknown;
}

export function paymentMethodScopeLabel(scope: "agency_default" | "subscription" | "none", lang: ClientBillingLang) {
  const t = clientBillingCopy(lang);
  if (scope === "agency_default") return t.agencyDefaultScope;
  if (scope === "subscription") return t.subscriptionScope;
  return "";
}

export function interpolateCopy(template: string, values: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
}
