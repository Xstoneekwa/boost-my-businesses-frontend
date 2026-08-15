import {
  CLIENT_EMAIL_NEEDS_MORE_CAMPAIGN_READY_THRESHOLD,
  type ClientEmailAllowedVariable,
  type ClientEmailTemplateCategory,
} from "./client-email-constants.ts";
import type { ResolvedTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import { buildNeedsMoreTargetingDashboardUrl } from "./client-email-needs-more-targeting-url.ts";
import { normalizeAdminLifecycleStatus } from "./client-email-lifecycle-contract.ts";

export type ClientEmailLocale = "fr" | "en";

export type ClientEmailRenderContextResult =
  | { ok: true; values: Record<ClientEmailAllowedVariable, string> }
  | {
    ok: false;
    code: "lifecycle_email_render_context_incomplete";
    missing: string[];
  };

function readMetadataLocaleValue(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const record = metadata as Record<string, unknown>;
  for (const key of ["preferred_language", "preferredLanguage", "locale", "language"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function resolveClientEmailLocale(metadata: unknown): ClientEmailLocale {
  const normalized = readMetadataLocaleValue(metadata).toLowerCase().replace("_", "-");
  return normalized === "en" || normalized.startsWith("en-") ? "en" : "fr";
}

export function localizedAccountStatus(input: {
  category: ClientEmailTemplateCategory;
  adminLifecycleStatus: string;
  locale: ClientEmailLocale;
}): string {
  const lifecycle = normalizeAdminLifecycleStatus(input.adminLifecycleStatus);
  const canonical = input.category === "account_paused"
    ? "paused"
    : input.category === "account_canceled"
      ? "cancelled"
      : input.category === "needs_assistance"
        ? "needs_assistance"
        : lifecycle;

  const labels: Record<ClientEmailLocale, Record<string, string>> = {
    fr: {
      active: "Active",
      paused: "En pause",
      cancelled: "Résiliée",
      canceled: "Résiliée",
      needs_assistance: "Assistance requise",
    },
    en: {
      active: "Active",
      paused: "Paused",
      cancelled: "Cancelled",
      canceled: "Cancelled",
      needs_assistance: "Needs assistance",
    },
  };
  return labels[input.locale][canonical] ?? canonical.replaceAll("_", " ");
}

export function buildCanonicalClientEmailRenderContext(input: {
  category: ClientEmailTemplateCategory;
  accountId: string;
  clientId: string;
  instagramUsername: string | null;
  clientLabel: string | null;
  adminLifecycleStatus: string;
  locale: ClientEmailLocale;
  deliverySettings: ResolvedTransactionalDeliverySettings;
  eligibleTargetCount?: number;
}): ClientEmailRenderContextResult {
  const accountId = input.accountId.trim();
  const clientId = input.clientId.trim();
  const instagramUsername = input.instagramUsername?.trim() ?? "";
  const clientLabel = input.clientLabel?.trim() ?? "";
  const supportEmail = input.deliverySettings.supportEmail.trim();
  const missing: string[] = [];

  if (!accountId) missing.push("account_id");
  if (!clientId) missing.push("client_id");
  if (!instagramUsername) missing.push("instagram_username");
  if (!clientLabel) missing.push("client_name");
  if (!supportEmail) missing.push("support_email");
  if (!input.adminLifecycleStatus.trim()) missing.push("admin_lifecycle_status");
  if (missing.length > 0) {
    return { ok: false, code: "lifecycle_email_render_context_incomplete", missing };
  }

  return {
    ok: true,
    values: {
      client_name: clientLabel,
      instagram_username: instagramUsername,
      account_status: localizedAccountStatus({
        category: input.category,
        adminLifecycleStatus: input.adminLifecycleStatus,
        locale: input.locale,
      }),
      eligible_target_count: String(Math.max(0, input.eligibleTargetCount ?? 0)),
      target_threshold: String(CLIENT_EMAIL_NEEDS_MORE_CAMPAIGN_READY_THRESHOLD),
      dashboard_url: buildNeedsMoreTargetingDashboardUrl(accountId),
      support_email: supportEmail,
    },
  };
}
