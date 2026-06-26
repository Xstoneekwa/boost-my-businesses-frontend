import { createSupabaseClient } from "@/lib/supabase";
import { getAccountPackageSummaries } from "@/app/instagram-dashboard/package-summary-data";
import { projectClientAccountRow } from "./account-projection";
import { readString, rejectTechnicalClientFields } from "./guards";
import {
  loadClientCommercialSubscriptionRow,
  projectClientSubscriptionDisplay,
  type ClientBillingDisplayMode,
} from "./client-subscription-projection";

type SupabaseRecord = Record<string, unknown>;

export type ClientLinkedInstagramAccount = {
  accountId: string;
  username: string;
  packageLabel: string;
  statusLabel: string;
  connected: boolean;
};

export type ClientBillingSummary = {
  status: "not_configured" | "configured";
  nextBillingLabel: string;
  paymentMethodLabel: string;
  invoicesAvailable: boolean;
  displayMode: ClientBillingDisplayMode;
  periodEndLabel: string;
};

export type ClientAccountManagerView = {
  name: string;
  subtitle: string;
  email: string;
  bookingUrl: string;
  bio: string;
};

export type ClientWorkspaceView = {
  clientId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  authEmail: string;
  contactEmail: string;
  emailEditable: boolean;
  phone: string;
  servicePageUrl: string;
  preferredLanguage: "fr" | "en";
  clientPlanLabel: string;
  memberSince: string | null;
  subscriptionPeriodEnd: string | null;
  billingDisplayMode: ClientBillingDisplayMode;
  paymentMethodDisplay: string;
  subscriptionLabel: string;
  subscriptionStatus: string;
  subscriptionSince: string | null;
  subscriptionPriceLabel: string;
  subscriptionGrowthLabel: string;
  subscriptionSupportLabel: string;
  campaignActive: boolean;
  linkedInstagramAccounts: ClientLinkedInstagramAccount[];
  billing: ClientBillingSummary;
  accountManager: ClientAccountManagerView;
};

function readMetadataString(metadata: SupabaseRecord | null, key: string, fallback = "") {
  if (!metadata) return fallback;
  return readString(metadata[key], fallback);
}

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function billingSummary(metadata: SupabaseRecord | null, subscription: {
  billingDisplayMode: ClientBillingDisplayMode;
  paymentMethodDisplay: string;
  subscriptionPeriodEnd: string | null;
}): ClientBillingSummary {
  const paymentMethod = readMetadataString(metadata, "payment_method_label");
  const nextBillingAt = readMetadataString(metadata, "next_billing_at");
  const billingProvider = readMetadataString(metadata, "billing_provider");
  const configured = Boolean(paymentMethod || nextBillingAt || billingProvider);
  return {
    status: configured ? "configured" : "not_configured",
    nextBillingLabel: subscription.billingDisplayMode === "next_billing"
      ? (nextBillingAt || "")
      : (subscription.subscriptionPeriodEnd || ""),
    paymentMethodLabel: subscription.paymentMethodDisplay || paymentMethod || "",
    invoicesAvailable: readMetadataString(metadata, "billing_invoices_enabled") === "true",
    displayMode: subscription.billingDisplayMode,
    periodEndLabel: subscription.subscriptionPeriodEnd || "",
  };
}

function clientFriendlyLinkStatus(loginStatus: string, onboardingStatus: string) {
  if (loginStatus === "connected") return "Connected";
  if (onboardingStatus === "ready") return "Ready";
  if (loginStatus === "needs_2fa" || loginStatus === "checkpoint") return "Verification required";
  return "Setup pending";
}

async function loadLinkedInstagramAccounts(clientId: string): Promise<ClientLinkedInstagramAccount[]> {
  const supabase = createSupabaseClient();
  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,onboarding_status,provisioning_status,login_status")
    .eq("client_id", clientId)
    .limit(100);

  if (linkError || !Array.isArray(links) || links.length === 0) return [];

  const accountIds = [...new Set((links as SupabaseRecord[]).map((row) => readString(row.account_id)).filter(Boolean))];
  if (!accountIds.length) return [];

  const [{ data: accounts }, { data: packages }] = await Promise.all([
    supabase
      .from("ig_accounts")
      .select("id,username,status,admin_lifecycle_status")
      .in("id", accountIds),
    supabase
      .from("account_commercial_packages")
      .select("account_id,package_code,status")
      .in("account_id", accountIds)
      .eq("status", "active"),
  ]);

  const packageByAccount = new Map((Array.isArray(packages) ? packages as SupabaseRecord[] : [])
    .map((row): [string, string] => [readString(row.account_id), readString(row.package_code, "growth")])
    .filter(([id]) => Boolean(id)));
  const linkByAccount = new Map((links as SupabaseRecord[])
    .map((row): [string, SupabaseRecord] => [readString(row.account_id), row])
    .filter(([id]) => Boolean(id)));

  return (Array.isArray(accounts) ? accounts as SupabaseRecord[] : [])
    .map((row) => {
      const accountId = readString(row.id);
      const link = linkByAccount.get(accountId);
      const loginStatus = readString(link?.login_status, "unknown");
      const onboardingStatus = readString(link?.onboarding_status, "pending");
      const projected = projectClientAccountRow({
        accountId,
        username: readString(row.username, "Instagram account"),
        packageLabel: packageByAccount.get(accountId) || "Growth",
        accountStatus: readString(row.admin_lifecycle_status, readString(row.status, "active")),
        onboardingStatus,
        provisioningStatus: readString(link?.provisioning_status, "not_started"),
        loginStatus,
        assignmentStatus: onboardingStatus === "ready" ? "assigned" : "pending_assignment",
      });
      return {
        accountId: projected.accountId,
        username: projected.username,
        packageLabel: projected.packageLabel,
        statusLabel: clientFriendlyLinkStatus(loginStatus, onboardingStatus),
        connected: projected.connected,
      } satisfies ClientLinkedInstagramAccount;
    })
    .filter((row) => Boolean(row.accountId && row.username))
    .sort((left, right) => left.username.localeCompare(right.username));
}

export async function getClientWorkspaceView(clientId: string, loginEmail = ""): Promise<ClientWorkspaceView | null> {
  if (!clientId) return null;
  const supabase = createSupabaseClient();
  const { data: client, error } = await supabase
    .from("clients")
    .select("id,name,status,metadata,created_at")
    .eq("id", clientId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  if (error || !client?.id) return null;

  const metadata = (client.metadata && typeof client.metadata === "object" && !Array.isArray(client.metadata))
    ? client.metadata as SupabaseRecord
    : null;
  const displayName = readMetadataString(metadata, "display_name", readString(client.name, "Client"));
  const split = splitDisplayName(displayName);
  const firstName = readMetadataString(metadata, "first_name", split.firstName);
  const lastName = readMetadataString(metadata, "last_name", split.lastName);
  const preferredLanguage = readMetadataString(metadata, "preferred_language", "fr") === "en" ? "en" : "fr";
  const authEmail = readString(loginEmail);
  const contactEmail = readMetadataString(metadata, "contact_email", authEmail);

  const { data: subscriptions } = await supabase
    .from("client_subscriptions")
    .select("status,starts_at,metadata")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("starts_at", { ascending: false })
    .limit(1);

  const subscription = Array.isArray(subscriptions) && subscriptions[0]
    ? subscriptions[0] as SupabaseRecord
    : null;
  const subscriptionMetadata = subscription?.metadata && typeof subscription.metadata === "object"
    ? subscription.metadata as SupabaseRecord
    : null;
  const subscriptionStartsAt = readString(subscription?.starts_at) || null;

  const linkedInstagramAccountsRaw = await loadLinkedInstagramAccounts(clientId);
  const packageSummaries = linkedInstagramAccountsRaw.length
    ? await getAccountPackageSummaries(linkedInstagramAccountsRaw.map((row) => row.accountId))
    : new Map();
  const linkedAccountPackageCodes = linkedInstagramAccountsRaw
    .map((row) => readString(packageSummaries.get(row.accountId)?.commercialPackageCode, row.packageLabel))
    .filter(Boolean);
  const subscriptionPlanKey = readMetadataString(subscriptionMetadata, "plan_key")
    || readMetadataString(subscriptionMetadata, "commercial_package_code");

  const commercial = await loadClientCommercialSubscriptionRow(supabase, clientId);
  const subscriptionProjection = projectClientSubscriptionDisplay({
    commercial,
    subscriptionStartsAt,
    clientCreatedAt: readString(client.created_at) || null,
    clientMetadata: metadata,
    preferredLanguage,
    linkedAccountPackageCodes,
    subscriptionPlanKey,
  });
  const linkedInstagramAccounts = linkedInstagramAccountsRaw.map((row) => ({
    ...row,
    packageLabel: packageSummaries.get(row.accountId)?.commercialPackageLabel || row.packageLabel,
  }));
  const campaignActive = linkedInstagramAccounts.some((row) => row.connected)
    || [...packageSummaries.values()].some((summary) => summary.commercialPackageLabel && summary.commercialPackageLabel !== "Package pending");

  const subscriptionGrowthLabel = subscriptionProjection.subscriptionGrowthLabel
    || readMetadataString(subscriptionMetadata, "growth_estimate_label");
  const subscriptionPriceLabel = subscriptionProjection.subscriptionPriceLabel
    || readMetadataString(subscriptionMetadata, "price_label", readMetadataString(subscriptionMetadata, "monthly_price_label"));
  const subscriptionSupportLabel = subscriptionProjection.subscriptionSupportLabel
    || readMetadataString(subscriptionMetadata, "support_label");
  const accountManager = {
    name: readMetadataString(metadata, "account_manager_name"),
    subtitle: readMetadataString(metadata, "account_manager_subtitle"),
    email: readMetadataString(metadata, "account_manager_email"),
    bookingUrl: readMetadataString(metadata, "account_manager_booking_url"),
    bio: readMetadataString(metadata, "account_manager_bio"),
  };

  const billing = billingSummary(metadata, subscriptionProjection);

  return {
    clientId,
    displayName,
    firstName,
    lastName,
    authEmail,
    contactEmail,
    emailEditable: false,
    phone: readMetadataString(metadata, "phone"),
    servicePageUrl: readMetadataString(metadata, "service_page_url", "/instagram-growth"),
    preferredLanguage,
    clientPlanLabel: subscriptionProjection.clientPlanLabel,
    memberSince: subscriptionProjection.memberSince,
    subscriptionPeriodEnd: subscriptionProjection.subscriptionPeriodEnd,
    billingDisplayMode: subscriptionProjection.billingDisplayMode,
    paymentMethodDisplay: subscriptionProjection.paymentMethodDisplay,
    subscriptionLabel: subscriptionProjection.clientPlanLabel,
    subscriptionStatus: readString(subscription?.status, subscriptionProjection.subscriptionStatus),
    subscriptionSince: subscriptionStartsAt || subscriptionProjection.memberSince,
    subscriptionPriceLabel,
    subscriptionGrowthLabel,
    subscriptionSupportLabel,
    campaignActive,
    linkedInstagramAccounts,
    billing,
    accountManager,
  };
}

export type ClientWorkspacePatchInput = {
  firstName?: string;
  lastName?: string;
  contactEmail?: string;
  phone?: string;
  servicePageUrl?: string;
  preferredLanguage?: string;
};

export async function updateClientWorkspaceView(
  clientId: string,
  input: ClientWorkspacePatchInput,
  loginEmail = "",
): Promise<{ ok: true; workspace: ClientWorkspaceView } | { ok: false; status: number; error: string }> {
  const rejected = rejectTechnicalClientFields(input as Record<string, unknown>);
  if (rejected) return { ok: false, status: 400, error: rejected };

  const supabase = createSupabaseClient();
  const { data: client, error } = await supabase
    .from("clients")
    .select("id,name,status,metadata")
    .eq("id", clientId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  if (error || !client?.id) return { ok: false, status: 404, error: "Client workspace not found." };

  const metadata = (client.metadata && typeof client.metadata === "object" && !Array.isArray(client.metadata))
    ? { ...(client.metadata as SupabaseRecord) }
    : {};

  const firstName = input.firstName !== undefined ? readString(input.firstName).trim() : readMetadataString(metadata, "first_name");
  const lastName = input.lastName !== undefined ? readString(input.lastName).trim() : readMetadataString(metadata, "last_name");
  const phone = input.phone !== undefined ? readString(input.phone).trim() : readMetadataString(metadata, "phone");
  const servicePageUrl = input.servicePageUrl !== undefined ? readString(input.servicePageUrl).trim() : readMetadataString(metadata, "service_page_url", "/instagram-growth");
  const preferredLanguage = input.preferredLanguage !== undefined
    ? (readString(input.preferredLanguage) === "en" ? "en" : "fr")
    : (readMetadataString(metadata, "preferred_language", "fr") === "en" ? "en" : "fr");
  const authEmail = readString(loginEmail);
  const contactEmail = readMetadataString(metadata, "contact_email", authEmail);

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || readString(client.name, "Client");
  const nextMetadata = {
    ...metadata,
    display_name: displayName,
    first_name: firstName,
    last_name: lastName,
    contact_email: contactEmail || authEmail,
    phone,
    service_page_url: servicePageUrl || "/instagram-growth",
    preferred_language: preferredLanguage,
  };

  const { error: updateError } = await supabase
    .from("clients")
    .update({ name: displayName, metadata: nextMetadata })
    .eq("id", clientId);

  if (updateError) return { ok: false, status: 500, error: "Could not save client profile." };

  const workspace = await getClientWorkspaceView(clientId, authEmail);
  if (!workspace) return { ok: false, status: 500, error: "Profile saved but reload failed." };
  return { ok: true, workspace };
}
