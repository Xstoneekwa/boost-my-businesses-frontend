import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { COMMERCIAL_PLANS, OUTREACH_ADDONS, type PlanKey } from "../catalog.ts";
import {
  clientBillingCopy,
  interpolateCopy,
  invoiceStatusLabel,
} from "./client-billing-copy.ts";
import type {
  ClientBillingAccountRow,
  ClientBillingLang,
  ClientBillingPortalState,
  ClientBillingView,
  ClientInvoiceStatus,
  ClientSafeInvoice,
  ClientSafePaymentMethod,
} from "./client-billing-types.ts";
import { readStripeTestConfig } from "./stripe-config.ts";
import { getStripeClient } from "./stripe-client.ts";

type Row = Record<string, unknown>;

type SubscriptionProjectionRow = {
  stripeSubscriptionId: string;
  accountId: string | null;
  entitlementId: string | null;
  commercialMode: string | null;
  status: string;
  currentPeriodEnd: string | null;
  stripePriceId: string | null;
};

type EntitlementRow = {
  id: string;
  accountId: string | null;
  planKey: string | null;
  commercialPackageCode: string | null;
  outreachAddonKey: string | null;
  billingIntervalMonths: number | null;
  packMonthlyDiscountedCents: number | null;
};

type PackageSummaryRow = {
  accountId: string;
  commercialPackageLabel: string;
};

type StripeCardLike = {
  brand?: string | null;
  last4?: string | null;
  exp_month?: number | null;
  exp_year?: number | null;
};

type StripePaymentMethodLike = {
  id?: string;
  card?: StripeCardLike | null;
};

type StripeInvoiceLike = {
  id: string;
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null;
  subscription: string | Stripe.Subscription | null;
  status: string | null;
  created: number;
  currency: string | null;
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  total: number;
  amount_refunded?: number;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  lines?: { data?: Array<{ description?: string | null }> };
};

export type ClientBillingStripeGateway = {
  retrieveCustomer: (customerId: string) => Promise<{
    invoice_settings?: { default_payment_method?: StripePaymentMethodLike | string | null };
  }>;
  listSubscriptions: (customerId: string) => Promise<Array<{
    id: string;
    default_payment_method?: StripePaymentMethodLike | string | null;
    status?: string;
  }>>;
  listInvoices: (customerId: string, createdGte: number) => Promise<StripeInvoiceLike[]>;
  retrieveInvoice: (invoiceId: string) => Promise<StripeInvoiceLike>;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function readNullableString(value: unknown) {
  const normalized = readString(value);
  return normalized || null;
}

function capitalizeBrand(value: string) {
  if (!value) return "Card";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function threeMonthsAgoUnix(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  return Math.floor(start.getTime() / 1000);
}

function formatMoney(amountMinor: number, currency: string, lang: ClientBillingLang) {
  const code = currency.toUpperCase() || "EUR";
  const amount = amountMinor / 100;
  try {
    return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function formatDateLabel(iso: string, lang: ClientBillingLang) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function resolveInvoiceStatus(invoice: StripeInvoiceLike): ClientInvoiceStatus {
  if ((invoice.amount_refunded ?? 0) > 0) return "refunded";
  const status = readString(invoice.status).toLowerCase();
  if (status === "paid") return "paid";
  if (status === "open") return "open";
  if (status === "uncollectible") return "failed";
  if (status === "void") return "unknown";
  return "unknown";
}

function paymentMethodFromStripe(
  paymentMethod: StripePaymentMethodLike | string | null | undefined,
  scope: ClientSafePaymentMethod["scope"],
  lang: ClientBillingLang,
): ClientSafePaymentMethod {
  const t = clientBillingCopy(lang);
  if (!paymentMethod || typeof paymentMethod === "string") {
    return {
      available: false,
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      displayLabel: t.noPaymentMethod,
      scope: "none",
    };
  }
  const card = paymentMethod.card;
  if (!card?.last4) {
    return {
      available: false,
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      displayLabel: t.noPaymentMethod,
      scope: "none",
    };
  }
  const brand = capitalizeBrand(readString(card.brand, "card"));
  const expMonth = typeof card.exp_month === "number" ? card.exp_month : null;
  const expYear = typeof card.exp_year === "number" ? card.exp_year : null;
  const expSuffix = expMonth && expYear
    ? ` · ${String(expMonth).padStart(2, "0")}/${expYear}`
    : "";
  return {
    available: true,
    brand,
    last4: card.last4,
    expMonth,
    expYear,
    displayLabel: `${brand} •••• ${card.last4}${expSuffix}`,
    scope,
  };
}

function subscriptionStatusLabel(status: string, lang: ClientBillingLang) {
  const t = clientBillingCopy(lang);
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "trialing") return t.subscriptionActive;
  if (normalized === "past_due") return t.subscriptionPastDue;
  if (normalized === "canceled" || normalized === "cancelled") return t.subscriptionCanceled;
  if (normalized === "incomplete" || normalized === "incomplete_expired") return t.subscriptionIncomplete;
  return t.subscriptionOther;
}

function billingCadenceLabel(months: number | null, lang: ClientBillingLang) {
  const t = clientBillingCopy(lang);
  if (!months || months <= 1) return t.monthlyCadence;
  return interpolateCopy(t.multiMonthCadence, { months });
}

function resolvePlanLabel(input: {
  entitlement: EntitlementRow | null;
  commercialMode: string | null;
  packageLabel: string;
  lang: ClientBillingLang;
}) {
  const t = clientBillingCopy(input.lang);
  const mode = readString(input.commercialMode).toLowerCase();
  const outreachKey = readString(input.entitlement?.outreachAddonKey).toLowerCase();
  const outreachLabel = outreachKey && OUTREACH_ADDONS[outreachKey as keyof typeof OUTREACH_ADDONS]
    ? (input.lang === "fr"
      ? OUTREACH_ADDONS[outreachKey as keyof typeof OUTREACH_ADDONS].displayNameFr
      : OUTREACH_ADDONS[outreachKey as keyof typeof OUTREACH_ADDONS].displayNameEn)
    : "";

  if (mode === "outreach_only") {
    return outreachLabel || t.outreachOnly;
  }

  const planKey = readString(input.entitlement?.planKey || input.entitlement?.commercialPackageCode).toLowerCase();
  const packageLabel = planKey && planKey in COMMERCIAL_PLANS
    ? COMMERCIAL_PLANS[planKey as PlanKey].displayName
    : (input.packageLabel || "");

  if (outreachLabel && packageLabel) {
    return interpolateCopy(t.packageAndOutreach, { package: packageLabel });
  }
  return packageLabel || outreachLabel || pendingPlanLabel(input.lang);
}

function pendingPlanLabel(lang: ClientBillingLang) {
  return lang === "fr" ? "Formule active" : "Active plan";
}

function priceLabelFromEntitlement(entitlement: EntitlementRow | null, lang: ClientBillingLang) {
  const cents = entitlement?.packMonthlyDiscountedCents;
  if (!cents || cents <= 0) {
    return lang === "fr" ? "Montant indisponible" : "Amount unavailable";
  }
  return formatMoney(cents, "eur", lang);
}

async function loadTenantStripeCustomerId(supabase: SupabaseClient, clientId: string) {
  const { data } = await supabase
    .from("commercial_stripe_billing_profiles")
    .select("stripe_customer_id")
    .eq("client_id", clientId)
    .maybeSingle<Row>();
  return readNullableString(data?.stripe_customer_id);
}

async function loadSubscriptionProjections(supabase: SupabaseClient, clientId: string) {
  const { data } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("stripe_subscription_id,account_id,client_account_entitlement_id,commercial_mode,status,current_period_end,stripe_price_id")
    .eq("client_id", clientId)
    .limit(100);

  if (!Array.isArray(data)) return [] as SubscriptionProjectionRow[];
  return data.map((row) => ({
    stripeSubscriptionId: readString(row.stripe_subscription_id),
    accountId: readNullableString(row.account_id),
    entitlementId: readNullableString(row.client_account_entitlement_id),
    commercialMode: readNullableString(row.commercial_mode),
    status: readString(row.status, "unknown"),
    currentPeriodEnd: readNullableString(row.current_period_end),
    stripePriceId: readNullableString(row.stripe_price_id),
  })).filter((row) => row.stripeSubscriptionId);
}

async function loadEntitlements(supabase: SupabaseClient, clientId: string, entitlementIds: string[]) {
  if (!entitlementIds.length) return new Map<string, EntitlementRow>();
  const { data } = await supabase
    .from("client_account_entitlements")
    .select("id,account_id,plan_key,commercial_package_code,outreach_addon_key,billing_interval_months,pack_monthly_discounted_cents")
    .eq("client_id", clientId)
    .in("id", entitlementIds)
    .limit(100);

  const map = new Map<string, EntitlementRow>();
  if (!Array.isArray(data)) return map;
  for (const row of data) {
    const id = readString(row.id);
    if (!id) continue;
    map.set(id, {
      id,
      accountId: readNullableString(row.account_id),
      planKey: readNullableString(row.plan_key),
      commercialPackageCode: readNullableString(row.commercial_package_code),
      outreachAddonKey: readNullableString(row.outreach_addon_key),
      billingIntervalMonths: Number(row.billing_interval_months) || null,
      packMonthlyDiscountedCents: Number(row.pack_monthly_discounted_cents) || null,
    });
  }
  return map;
}

async function loadPackageSummaries(supabase: SupabaseClient, accountIds: string[]) {
  const map = new Map<string, PackageSummaryRow>();
  if (!accountIds.length) return map;

  const { data } = await supabase
    .from("account_package_summary")
    .select("account_id,commercial_package_code,commercial_package_label")
    .in("account_id", accountIds)
    .limit(100);

  if (!Array.isArray(data)) return map;
  for (const row of data) {
    const accountId = readString(row.account_id);
    if (!accountId) continue;
    const code = readString(row.commercial_package_code).toLowerCase();
    const label = readString(row.commercial_package_label);
    const packageLabel = label && !["full_cycle", "outreach_only"].includes(label.toLowerCase())
      ? label
      : (code && code in COMMERCIAL_PLANS ? COMMERCIAL_PLANS[code as PlanKey].displayName : label);
    map.set(accountId, { accountId, commercialPackageLabel: packageLabel || "" });
  }
  return map;
}

async function loadLinkedAccounts(supabase: SupabaseClient, clientId: string) {
  const { data: links } = await supabase
    .from("client_instagram_accounts")
    .select("account_id")
    .eq("client_id", clientId)
    .limit(100);
  const accountIds = Array.isArray(links)
    ? [...new Set(links.map((row) => readString((row as Row).account_id)).filter(Boolean))]
    : [];
  if (!accountIds.length) return [] as Array<{ accountId: string; username: string }>;

  const { data: accounts } = await supabase
    .from("ig_accounts")
    .select("id,username")
    .in("id", accountIds)
    .limit(100);

  if (!Array.isArray(accounts)) return [];
  return accounts.map((row) => ({
    accountId: readString(row.id),
    username: readString(row.username).replace(/^@+/, ""),
  })).filter((row) => row.accountId);
}

function readStripeCustomerId(value: StripeInvoiceLike["customer"]) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return readString((value as unknown as Row).id);
}

function readStripeSubscriptionId(value: StripeInvoiceLike["subscription"]) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return readNullableString((value as unknown as Row).id);
}

function resolveInvoiceServiceLabel(
  invoice: StripeInvoiceLike,
  projection: SubscriptionProjectionRow | null,
  entitlement: EntitlementRow | null,
  packageLabel: string,
  lang: ClientBillingLang,
) {
  const lineDescription = invoice.lines?.data?.find((line) => readString(line?.description))?.description;
  if (lineDescription) return readString(lineDescription);
  if (projection) {
    return resolvePlanLabel({
      entitlement,
      commercialMode: projection.commercialMode,
      packageLabel,
      lang,
    });
  }
  return lang === "fr" ? "Abonnement" : "Subscription";
}

function correlateInvoiceAccountId(input: {
  stripeSubscriptionId: string | null;
  projectionBySubscriptionId: Map<string, SubscriptionProjectionRow>;
  entitlementById: Map<string, EntitlementRow>;
  tenantAccountIds: Set<string>;
}) {
  if (!input.stripeSubscriptionId) {
    return { accountId: null as string | null, certain: false };
  }
  const projection = input.projectionBySubscriptionId.get(input.stripeSubscriptionId);
  if (!projection) {
    return { accountId: null, certain: false };
  }
  if (projection.accountId && input.tenantAccountIds.has(projection.accountId)) {
    return { accountId: projection.accountId, certain: true };
  }
  if (projection.entitlementId) {
    const entitlement = input.entitlementById.get(projection.entitlementId);
    if (entitlement?.accountId && input.tenantAccountIds.has(entitlement.accountId)) {
      return { accountId: entitlement.accountId, certain: true };
    }
  }
  return { accountId: null, certain: false };
}

function computeGlobalNextBillingLabel(
  projections: SubscriptionProjectionRow[],
  lang: ClientBillingLang,
) {
  const activeStatuses = new Set(["active", "trialing", "past_due"]);
  const ends = projections
    .filter((row) => activeStatuses.has(row.status.toLowerCase()) && row.currentPeriodEnd)
    .map((row) => new Date(String(row.currentPeriodEnd)).getTime())
    .filter((value) => Number.isFinite(value) && value > Date.now());
  if (!ends.length) return null;
  const unique = new Set(ends);
  if (unique.size !== 1) return null;
  return formatDateLabel(new Date(ends[0]).toISOString(), lang);
}

function buildPortalState(
  customerId: string | null,
  env: NodeJS.ProcessEnv,
): ClientBillingPortalState {
  if (!customerId) {
    return { available: false, reason: "customer_missing" };
  }
  const config = readStripeTestConfig(env);
  if (!config?.billingPortalConfigurationId) {
    return { available: false, reason: "portal_not_configured" };
  }
  return { available: true };
}

export function createStripeGatewayFromClient(stripe: Stripe): ClientBillingStripeGateway {
  return {
    async retrieveCustomer(customerId) {
      return stripe.customers.retrieve(customerId, {
        expand: ["invoice_settings.default_payment_method"],
      }) as Promise<{ invoice_settings?: { default_payment_method?: StripePaymentMethodLike | string | null } }>;
    },
    async listSubscriptions(customerId) {
      const page = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        expand: ["data.default_payment_method"],
      });
      return page.data.map((sub) => ({
        id: sub.id,
        default_payment_method: sub.default_payment_method as StripePaymentMethodLike | string | null,
        status: sub.status,
      }));
    },
    async listInvoices(customerId, createdGte) {
      const page = await stripe.invoices.list({
        customer: customerId,
        created: { gte: createdGte },
        limit: 100,
      });
      return page.data as StripeInvoiceLike[];
    },
    async retrieveInvoice(invoiceId) {
      return stripe.invoices.retrieve(invoiceId) as Promise<StripeInvoiceLike>;
    },
  };
}

function resolveEffectivePaymentMethod(input: {
  subscriptionId: string | null;
  customerDefault: StripePaymentMethodLike | string | null | undefined;
  subscriptionDefaultById: Map<string, StripePaymentMethodLike | string | null | undefined>;
  lang: ClientBillingLang;
}): ClientSafePaymentMethod {
  const subscriptionDefault = input.subscriptionId
    ? input.subscriptionDefaultById.get(input.subscriptionId)
    : null;
  if (subscriptionDefault && typeof subscriptionDefault !== "string") {
    const customerSame = input.customerDefault
      && typeof input.customerDefault !== "string"
      && subscriptionDefault.id
      && input.customerDefault.id
      && subscriptionDefault.id === input.customerDefault.id;
    return paymentMethodFromStripe(
      subscriptionDefault,
      customerSame ? "agency_default" : "subscription",
      input.lang,
    );
  }
  return paymentMethodFromStripe(input.customerDefault, "agency_default", input.lang);
}

export async function buildClientBillingView(input: {
  supabase: SupabaseClient;
  clientId: string;
  lang: ClientBillingLang;
  env?: NodeJS.ProcessEnv;
  stripeGateway?: ClientBillingStripeGateway | null;
  packageSummaries?: Map<string, PackageSummaryRow>;
}): Promise<ClientBillingView> {
  const lang = input.lang;
  const env = input.env ?? process.env;
  const customerId = await loadTenantStripeCustomerId(input.supabase, input.clientId);
  const linkedAccounts = await loadLinkedAccounts(input.supabase, input.clientId);
  const tenantAccountIds = new Set(linkedAccounts.map((row) => row.accountId));
  const projections = await loadSubscriptionProjections(input.supabase, input.clientId);
  const entitlementIds = [...new Set(projections.map((row) => row.entitlementId).filter(Boolean))] as string[];
  const entitlementById = await loadEntitlements(input.supabase, input.clientId, entitlementIds);
  const packageSummaries = input.packageSummaries
    ?? await loadPackageSummaries(input.supabase, [...tenantAccountIds]);
  const projectionBySubscriptionId = new Map(projections.map((row) => [row.stripeSubscriptionId, row]));
  const portal = buildPortalState(customerId, env);

  const emptyPaymentMethod = paymentMethodFromStripe(null, "none", lang);
  let defaultPaymentMethod = emptyPaymentMethod;
  let stripeInvoices: StripeInvoiceLike[] = [];
  const subscriptionDefaultById = new Map<string, StripePaymentMethodLike | string | null | undefined>();
  let customerDefaultPm: StripePaymentMethodLike | string | null | undefined = null;

  const gateway = input.stripeGateway ?? (customerId && readStripeTestConfig(env)
    ? createStripeGatewayFromClient(getStripeClient(env))
    : null);

  if (gateway && customerId) {
    const [customer, subscriptions] = await Promise.all([
      gateway.retrieveCustomer(customerId),
      gateway.listSubscriptions(customerId),
    ]);
    customerDefaultPm = customer.invoice_settings?.default_payment_method;
    for (const sub of subscriptions) {
      subscriptionDefaultById.set(sub.id, sub.default_payment_method);
    }
    defaultPaymentMethod = paymentMethodFromStripe(customerDefaultPm, "agency_default", lang);
    stripeInvoices = await gateway.listInvoices(customerId, threeMonthsAgoUnix());
    stripeInvoices.sort((a, b) => b.created - a.created);
  }

  const safeInvoices: ClientSafeInvoice[] = [];
  for (const invoice of stripeInvoices) {
    if (readStripeCustomerId(invoice.customer) !== customerId) continue;
    const stripeSubscriptionId = readStripeSubscriptionId(invoice.subscription);
    const correlation = correlateInvoiceAccountId({
      stripeSubscriptionId,
      projectionBySubscriptionId,
      entitlementById,
      tenantAccountIds,
    });
    const projection = stripeSubscriptionId ? projectionBySubscriptionId.get(stripeSubscriptionId) ?? null : null;
    const entitlement = projection?.entitlementId ? entitlementById.get(projection.entitlementId) ?? null : null;
    const packageLabel = correlation.accountId
      ? readString(packageSummaries.get(correlation.accountId)?.commercialPackageLabel)
      : "";
    const status = resolveInvoiceStatus(invoice);
    safeInvoices.push({
      invoiceRef: invoice.id,
      dateIso: new Date(invoice.created * 1000).toISOString(),
      serviceLabel: resolveInvoiceServiceLabel(invoice, projection, entitlement, packageLabel, lang),
      amountLabel: formatMoney(invoice.total ?? invoice.amount_due ?? 0, readString(invoice.currency, "eur"), lang),
      currency: readString(invoice.currency, "eur").toUpperCase(),
      status,
      statusLabel: invoiceStatusLabel(status, lang),
      accountUsername: correlation.certain && correlation.accountId
        ? (linkedAccounts.find((row) => row.accountId === correlation.accountId)?.username ?? null)
        : null,
      correlationCertain: correlation.certain,
      canView: Boolean(invoice.hosted_invoice_url),
      canDownloadPdf: Boolean(invoice.invoice_pdf),
    });
  }

  const accountRows: ClientBillingAccountRow[] = linkedAccounts.map((account) => {
    const accountProjections = projections.filter((row) => row.accountId === account.accountId
      || (row.entitlementId && entitlementById.get(row.entitlementId)?.accountId === account.accountId));
    const primaryProjection = accountProjections[0] ?? null;
    const entitlement = primaryProjection?.entitlementId
      ? entitlementById.get(primaryProjection.entitlementId) ?? null
      : null;
    const packageLabel = readString(packageSummaries.get(account.accountId)?.commercialPackageLabel);
    const subscriptionId = primaryProjection?.stripeSubscriptionId ?? null;
    return {
      accountId: account.accountId,
      username: account.username,
      planLabel: resolvePlanLabel({
        entitlement,
        commercialMode: primaryProjection?.commercialMode ?? null,
        packageLabel,
        lang,
      }),
      subscriptionStatusLabel: primaryProjection
        ? subscriptionStatusLabel(primaryProjection.status, lang)
        : (lang === "fr" ? "Non facturé" : "Not billed"),
      priceLabel: priceLabelFromEntitlement(entitlement, lang),
      billingCadenceLabel: billingCadenceLabel(entitlement?.billingIntervalMonths ?? null, lang),
      nextBillingLabel: primaryProjection?.currentPeriodEnd
        ? formatDateLabel(primaryProjection.currentPeriodEnd, lang)
        : null,
      paymentMethod: resolveEffectivePaymentMethod({
        subscriptionId,
        customerDefault: customerDefaultPm,
        subscriptionDefaultById,
        lang,
      }),
      invoices: safeInvoices.filter((invoice) => invoice.correlationCertain && invoice.accountUsername === account.username),
    };
  });

  const unassignedInvoices = safeInvoices.filter((invoice) => !invoice.correlationCertain);
  const mode: ClientBillingView["mode"] = linkedAccounts.length > 1 ? "agency" : "standard";

  return {
    mode,
    billingProfileAvailable: Boolean(customerId),
    portal,
    defaultPaymentMethod,
    globalNextBillingLabel: computeGlobalNextBillingLabel(projections, lang),
    recentInvoices: mode === "standard" ? safeInvoices : [],
    unassignedInvoices: mode === "agency" ? unassignedInvoices : [],
    accounts: accountRows,
  };
}

export async function resolveAuthorizedClientInvoiceDocument(input: {
  supabase: SupabaseClient;
  clientId: string;
  invoiceRef: string;
  kind: "hosted" | "pdf";
  env?: NodeJS.ProcessEnv;
  stripeGateway?: ClientBillingStripeGateway | null;
}) {
  const invoiceRef = readString(input.invoiceRef);
  if (!invoiceRef.startsWith("in_")) {
    return { ok: false as const, status: 400, code: "invoice_invalid" };
  }

  const customerId = await loadTenantStripeCustomerId(input.supabase, input.clientId);
  if (!customerId) {
    return { ok: false as const, status: 404, code: "billing_profile_missing" };
  }

  const env = input.env ?? process.env;
  const gateway = input.stripeGateway ?? (readStripeTestConfig(env)
    ? createStripeGatewayFromClient(getStripeClient(env))
    : null);
  if (!gateway) {
    return { ok: false as const, status: 503, code: "billing_unavailable" };
  }

  const invoice = await gateway.retrieveInvoice(invoiceRef);
  if (readStripeCustomerId(invoice.customer) !== customerId) {
    return { ok: false as const, status: 403, code: "invoice_forbidden" };
  }

  const url = input.kind === "pdf" ? readNullableString(invoice.invoice_pdf) : readNullableString(invoice.hosted_invoice_url);
  if (!url) {
    return { ok: false as const, status: 404, code: input.kind === "pdf" ? "invoice_pdf_missing" : "invoice_hosted_missing" };
  }

  return { ok: true as const, url };
}

export function assertClientBillingPayloadSafe(payload: ClientBillingView) {
  const serialized = JSON.stringify(payload);
  const forbidden = ["cus_", "sub_", "pm_", "sk_test_", "sk_live_", "whsec_", "entitlement", "webhook", "foundation"];
  for (const token of forbidden) {
    if (serialized.includes(token)) {
      throw new Error(`client_billing_payload_unsafe:${token}`);
    }
  }
}
