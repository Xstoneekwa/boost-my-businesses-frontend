export type ClientBillingLang = "fr" | "en";

export type ClientPaymentMethodScope = "agency_default" | "subscription" | "none";

export type ClientSafePaymentMethod = {
  available: boolean;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  displayLabel: string;
  scope: ClientPaymentMethodScope;
};

export type ClientInvoiceStatus = "paid" | "open" | "failed" | "refunded" | "unknown";

export type ClientSafeInvoice = {
  invoiceRef: string;
  dateIso: string;
  serviceLabel: string;
  amountLabel: string;
  currency: string;
  status: ClientInvoiceStatus;
  statusLabel: string;
  accountUsername: string | null;
  correlationCertain: boolean;
  canView: boolean;
  canDownloadPdf: boolean;
};

export type ClientBillingAccountRow = {
  accountId: string;
  username: string;
  planLabel: string;
  subscriptionStatusLabel: string;
  priceLabel: string;
  billingCadenceLabel: string;
  nextBillingLabel: string | null;
  paymentMethod: ClientSafePaymentMethod;
  invoices: ClientSafeInvoice[];
};

export type ClientBillingPortalState =
  | { available: true }
  | { available: false; reason: "portal_not_configured" | "customer_missing" | "billing_unavailable" };

export type ClientBillingView = {
  mode: "standard" | "agency";
  billingProfileAvailable: boolean;
  portal: ClientBillingPortalState;
  defaultPaymentMethod: ClientSafePaymentMethod;
  globalNextBillingLabel: string | null;
  recentInvoices: ClientSafeInvoice[];
  unassignedInvoices: ClientSafeInvoice[];
  accounts: ClientBillingAccountRow[];
};
