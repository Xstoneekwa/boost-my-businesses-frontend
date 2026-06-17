import { createSupabaseClient } from "@/lib/supabase";
import { getAccountPackageSummaries } from "@/app/instagram-dashboard/package-summary-data";
import { readString, rejectTechnicalClientFields } from "./guards";

type SupabaseRecord = Record<string, unknown>;

export type ClientWorkspaceView = {
  clientId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  contactEmail: string;
  phone: string;
  servicePageUrl: string;
  preferredLanguage: "fr" | "en";
  subscriptionType: string;
  subscriptionLabel: string;
  subscriptionStatus: string;
  subscriptionSince: string | null;
  campaignActive: boolean;
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

function formatPackageLabel(code: string, metadata: SupabaseRecord | null) {
  const label = readMetadataString(metadata, "label");
  if (label) return label;
  return code.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
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

  const { data: subscriptions } = await supabase
    .from("client_subscriptions")
    .select("subscription_type,status,starts_at,metadata")
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
  const subscriptionType = readString(subscription?.subscription_type, "full_cycle");
  const subscriptionLabel = formatPackageLabel(subscriptionType, subscriptionMetadata);

  const { data: links } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,login_status,onboarding_status")
    .eq("client_id", clientId)
    .limit(20);
  const accountIds = (Array.isArray(links) ? links as SupabaseRecord[] : [])
    .map((row) => readString(row.account_id))
    .filter(Boolean);
  const packageSummaries = accountIds.length ? await getAccountPackageSummaries(accountIds) : new Map();
  const campaignActive = (Array.isArray(links) ? links as SupabaseRecord[] : []).some((row) => {
    const loginStatus = readString(row.login_status, "");
    const onboardingStatus = readString(row.onboarding_status, "");
    return loginStatus === "connected" || onboardingStatus === "ready";
  }) || [...packageSummaries.values()].some((summary) => summary.commercialPackageLabel && summary.commercialPackageLabel !== "Package pending");

  return {
    clientId,
    displayName,
    firstName,
    lastName,
    contactEmail: readMetadataString(metadata, "contact_email", loginEmail),
    phone: readMetadataString(metadata, "phone"),
    servicePageUrl: readMetadataString(metadata, "service_page_url", "/instagram-growth"),
    preferredLanguage,
    subscriptionType,
    subscriptionLabel: packageSummaries.get(accountIds[0] || "")?.commercialPackageLabel || subscriptionLabel,
    subscriptionStatus: readString(subscription?.status, "active"),
    subscriptionSince: readString(subscription?.starts_at) || readString(client.created_at) || null,
    campaignActive,
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
  const contactEmail = input.contactEmail !== undefined ? readString(input.contactEmail).trim() : readMetadataString(metadata, "contact_email");
  const phone = input.phone !== undefined ? readString(input.phone).trim() : readMetadataString(metadata, "phone");
  const servicePageUrl = input.servicePageUrl !== undefined ? readString(input.servicePageUrl).trim() : readMetadataString(metadata, "service_page_url", "/instagram-growth");
  const preferredLanguage = input.preferredLanguage !== undefined
    ? (readString(input.preferredLanguage) === "en" ? "en" : "fr")
    : (readMetadataString(metadata, "preferred_language", "fr") === "en" ? "en" : "fr");

  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return { ok: false, status: 400, error: "Invalid contact email." };
  }

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || readString(client.name, "Client");
  const nextMetadata = {
    ...metadata,
    display_name: displayName,
    first_name: firstName,
    last_name: lastName,
    contact_email: contactEmail,
    phone,
    service_page_url: servicePageUrl || "/instagram-growth",
    preferred_language: preferredLanguage,
  };

  const { error: updateError } = await supabase
    .from("clients")
    .update({ name: displayName, metadata: nextMetadata })
    .eq("id", clientId);

  if (updateError) return { ok: false, status: 500, error: "Could not save client profile." };

  const workspace = await getClientWorkspaceView(clientId, contactEmail);
  if (!workspace) return { ok: false, status: 500, error: "Profile saved but reload failed." };
  return { ok: true, workspace };
}
