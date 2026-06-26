import { readString } from "./guards.ts";
import { loadTargetEligibilityCountsForAccount } from "../instagram-dashboard/account-target-eligibility.ts";
import {
  NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
  loadActiveNeedsMoreTargetAccountsAction,
} from "../instagram-dashboard/needs-more-target-accounts.ts";
import {
  emptyClientAccountNotificationsProjection,
  probeClientAccountNotificationsTable,
} from "./client-account-notifications-schema-guard.ts";
import type { ClientAccountNotificationsSupabase } from "./client-account-notifications-supabase.ts";

export type { ClientAccountNotificationsSupabase } from "./client-account-notifications-supabase.ts";

export {
  CLIENT_ACCOUNT_NOTIFICATIONS_TABLE,
  emptyClientAccountNotificationsProjection,
  isClientAccountNotificationsTableMissingError,
  probeClientAccountNotificationsTable,
} from "./client-account-notifications-schema-guard.ts";

export const CLIENT_NOTIFICATION_CATEGORIES = [
  "needs_more_target_accounts",
  "needs_assistance",
  "account_paused",
  "account_canceled",
] as const;

export type ClientNotificationCategory = typeof CLIENT_NOTIFICATION_CATEGORIES[number];

export type ClientNotificationStatus = "active" | "resolved";

export type ClientAccountNotificationMetadata = {
  username: string;
  eligible_target_count?: number;
  threshold?: number;
  lifecycle_status?: string;
  reason?: string;
};

export type ClientAccountNotificationView = {
  id: string;
  accountId: string;
  username: string;
  category: ClientNotificationCategory;
  title: string;
  message: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  status: ClientNotificationStatus;
  canMarkRead: boolean;
};

export type ClientAccountNotificationsProjection = {
  /** False when the notifications table is not migrated yet. */
  featureAvailable: boolean;
  active: ClientAccountNotificationView[];
  recentResolved: ClientAccountNotificationView[];
  /** Number of unresolved active notifications — used for topbar/panel badges. */
  activeCount: number;
  /** Subset of actives not yet marked read — visual distinction only. */
  unreadActiveCount: number;
};

type SupabaseRecord = Record<string, unknown>;

type NotificationSupabase = ClientAccountNotificationsSupabase;

function readMetadata(value: unknown): ClientAccountNotificationMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { username: "Instagram account" };
  }
  const row = value as SupabaseRecord;
  return {
    username: readString(row.username, "Instagram account"),
    eligible_target_count: typeof row.eligible_target_count === "number" ? row.eligible_target_count : undefined,
    threshold: typeof row.threshold === "number" ? row.threshold : undefined,
    lifecycle_status: readString(row.lifecycle_status, "") || undefined,
    reason: readString(row.reason, "") || undefined,
  };
}

export function buildClientNotificationKey(
  clientId: string,
  accountId: string,
  category: ClientNotificationCategory,
) {
  return `client:${clientId}:account:${accountId}:category:${category}`;
}

export function buildClientNotificationCopy(
  category: ClientNotificationCategory,
  metadata: ClientAccountNotificationMetadata,
  lang: "fr" | "en" = "fr",
) {
  const username = metadata.username.startsWith("@") ? metadata.username : `@${metadata.username}`;
  if (category === "needs_more_target_accounts") {
    return {
      title: lang === "fr" ? "Comptes cibles à compléter" : "More target accounts needed",
      message: lang === "fr"
        ? `${username} a besoin de nouveaux comptes cibles. Ajoutez des comptes cibles pour relancer la campagne.`
        : `${username} needs more target accounts. Add target accounts to keep the campaign running.`,
      ctaLabel: lang === "fr" ? "Ajouter des comptes cibles" : "Add target accounts",
      ctaHref: "/instagram-client?view=targeting",
    };
  }
  if (category === "needs_assistance") {
    return {
      title: lang === "fr" ? "Assistance requise" : "Assistance required",
      message: lang === "fr"
        ? `${username} nécessite une assistance de notre équipe. Nous vous recontacterons dès que possible.`
        : `${username} needs assistance from our team. We will follow up as soon as possible.`,
      ctaLabel: lang === "fr" ? "Voir mon compte" : "View my account",
      ctaHref: "/instagram-client?view=account",
    };
  }
  if (category === "account_paused") {
    return {
      title: lang === "fr" ? "Campagne en pause" : "Campaign paused",
      message: lang === "fr"
        ? `La campagne de ${username} est actuellement en pause.`
        : `The campaign for ${username} is currently paused.`,
      ctaLabel: null,
      ctaHref: null,
    };
  }
  return {
    title: lang === "fr" ? "Compte annulé" : "Account canceled",
    message: lang === "fr"
      ? `${username} a été annulé. Contactez le support si vous souhaitez le réactiver.`
      : `${username} has been canceled. Contact support if you want to reactivate it.`,
    ctaLabel: lang === "fr" ? "Voir mon compte" : "View my account",
    ctaHref: "/instagram-client?view=account",
  };
}

function projectNotificationRow(
  row: SupabaseRecord,
  lang: "fr" | "en" = "fr",
): ClientAccountNotificationView {
  const category = readString(row.category, "") as ClientNotificationCategory;
  const metadata = readMetadata(row.metadata_safe);
  const copy = buildClientNotificationCopy(category, metadata, lang);
  const status = readString(row.status, "active") as ClientNotificationStatus;
  return {
    id: readString(row.id, ""),
    accountId: readString(row.account_id, ""),
    username: metadata.username,
    category,
    title: copy.title,
    message: copy.message,
    ctaLabel: copy.ctaLabel,
    ctaHref: copy.ctaHref,
    createdAt: readString(row.created_at, new Date().toISOString()),
    readAt: readString(row.read_at, "") || null,
    resolvedAt: readString(row.resolved_at, "") || null,
    status,
    canMarkRead: status === "active",
  };
}

async function loadClientIdForAccount(supabase: NotificationSupabase, accountId: string) {
  const { data, error } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return readString(data?.client_id, "") || null;
}

async function loadAccountIdsForClient(supabase: NotificationSupabase, clientId: string) {
  const { data, error } = await supabase
    .from("client_instagram_accounts")
    .select("account_id")
    .eq("client_id", clientId)
    .limit(200);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => readString(row.account_id, "")).filter(Boolean))];
}

async function loadAccountContext(
  supabase: NotificationSupabase,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id,username,admin_lifecycle_status,status")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    accountId,
    username: readString(data.username, "Instagram account"),
    lifecycleStatus: readString(data.admin_lifecycle_status, readString(data.status, "active")).toLowerCase(),
  };
}

async function loadActiveNotificationByKey(
  supabase: NotificationSupabase,
  notificationKey: string,
) {
  const { data, error } = await supabase
    .from("client_account_notifications")
    .select("id,status")
    .eq("notification_key", notificationKey)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function activateClientNotification(
  supabase: NotificationSupabase,
  input: {
    clientId: string;
    accountId: string;
    category: ClientNotificationCategory;
    metadata: ClientAccountNotificationMetadata;
    sourceActionId?: string | null;
  },
) {
  const notificationKey = buildClientNotificationKey(input.clientId, input.accountId, input.category);
  const existing = await loadActiveNotificationByKey(supabase, notificationKey);
  const payload = {
    client_id: input.clientId,
    account_id: input.accountId,
    category: input.category,
    status: "active",
    notification_key: notificationKey,
    source_action_id: input.sourceActionId ?? null,
    metadata_safe: input.metadata,
    resolved_at: null,
  };

  if (existing) {
    const { error } = await supabase
      .from("client_account_notifications")
      .update({
        metadata_safe: input.metadata,
        source_action_id: input.sourceActionId ?? null,
      })
      .eq("id", readString(existing.id, ""))
      .eq("status", "active");
    if (error) throw new Error(error.message);
    return { changed: "updated" as const, id: readString(existing.id, "") };
  }

  const { data, error } = await supabase
    .from("client_account_notifications")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { changed: "created" as const, id: readString(data?.id, "") };
}

async function resolveClientNotificationByKey(
  supabase: NotificationSupabase,
  notificationKey: string,
) {
  const existing = await loadActiveNotificationByKey(supabase, notificationKey);
  if (!existing) return { changed: "unchanged" as const, id: null };
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("client_account_notifications")
    .update({ status: "resolved", resolved_at: now })
    .eq("id", readString(existing.id, ""))
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return { changed: "resolved" as const, id: readString(existing.id, "") };
}

export type ClientNotificationDesiredState = {
  category: ClientNotificationCategory;
  active: boolean;
  metadata: ClientAccountNotificationMetadata;
  sourceActionId?: string | null;
};

export async function deriveClientNotificationDesiredStates(
  supabase: NotificationSupabase,
  input: { accountId: string; username: string; lifecycleStatus: string },
): Promise<ClientNotificationDesiredState[]> {
  const counts = await loadTargetEligibilityCountsForAccount(supabase, input.accountId);
  const needsMoreAction = await loadActiveNeedsMoreTargetAccountsAction(supabase, input.accountId);
  const eligibleCount = counts.eligible;
  const needsMoreActive = eligibleCount <= NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD;

  const baseMetadata: ClientAccountNotificationMetadata = {
    username: input.username,
    eligible_target_count: eligibleCount,
    threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
    lifecycle_status: input.lifecycleStatus,
  };

  return [
    {
      category: "needs_more_target_accounts",
      active: needsMoreActive,
      metadata: baseMetadata,
      sourceActionId: readString(needsMoreAction?.id, "") || null,
    },
    {
      category: "needs_assistance",
      active: input.lifecycleStatus === "needs_assistance",
      metadata: baseMetadata,
    },
    {
      category: "account_paused",
      active: input.lifecycleStatus === "paused",
      metadata: baseMetadata,
    },
    {
      category: "account_canceled",
      active: input.lifecycleStatus === "cancelled" || input.lifecycleStatus === "canceled",
      metadata: baseMetadata,
    },
  ];
}

export async function reconcileClientAccountNotificationsForAccount(
  supabase: NotificationSupabase,
  accountId: string,
) {
  const table = await probeClientAccountNotificationsTable(supabase);
  if (!table.available) {
    return { account_id: accountId, changed: [] as string[] };
  }

  const clientId = await loadClientIdForAccount(supabase, accountId);
  if (!clientId) return { account_id: accountId, changed: [] as string[] };

  const account = await loadAccountContext(supabase, accountId);
  if (!account) return { account_id: accountId, changed: [] as string[] };

  const desiredStates = await deriveClientNotificationDesiredStates(supabase, {
    accountId,
    username: account.username,
    lifecycleStatus: account.lifecycleStatus,
  });

  const changed: string[] = [];
  for (const state of desiredStates) {
    const key = buildClientNotificationKey(clientId, accountId, state.category);
    if (state.active) {
      const result = await activateClientNotification(supabase, {
        clientId,
        accountId,
        category: state.category,
        metadata: state.metadata,
        sourceActionId: state.sourceActionId,
      });
      if (result.changed !== "updated" || result.id) changed.push(`${state.category}:${result.changed}`);
    } else {
      const result = await resolveClientNotificationByKey(supabase, key);
      if (result.changed === "resolved") changed.push(`${state.category}:resolved`);
    }
  }

  return { account_id: accountId, client_id: clientId, changed };
}

export async function reconcileClientAccountNotificationsForClient(
  supabase: NotificationSupabase,
  clientId: string,
) {
  const table = await probeClientAccountNotificationsTable(supabase);
  if (!table.available) {
    return { client_id: clientId, accounts: [] as Array<{ account_id: string; changed: string[] }> };
  }

  const accountIds = await loadAccountIdsForClient(supabase, clientId);
  const results = [];
  for (const accountId of accountIds) {
    results.push(await reconcileClientAccountNotificationsForAccount(supabase, accountId));
  }
  return { client_id: clientId, accounts: results };
}

export async function loadClientAccountNotificationsForClient(
  supabase: NotificationSupabase,
  clientId: string,
  input: { lang?: "fr" | "en"; resolvedLimit?: number } = {},
) {
  const table = await probeClientAccountNotificationsTable(supabase);
  if (!table.available) {
    return emptyClientAccountNotificationsProjection(false);
  }

  const lang = input.lang ?? "fr";
  const resolvedLimit = input.resolvedLimit ?? 20;
  const [{ data: activeRows, error: activeError }, { data: resolvedRows, error: resolvedError }] = await Promise.all([
    supabase
      .from("client_account_notifications")
      .select("id,account_id,category,status,metadata_safe,created_at,resolved_at,read_at")
      .eq("client_id", clientId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("client_account_notifications")
      .select("id,account_id,category,status,metadata_safe,created_at,resolved_at,read_at")
      .eq("client_id", clientId)
      .eq("status", "resolved")
      .order("resolved_at", { ascending: false })
      .limit(resolvedLimit),
  ]);

  if (activeError) throw new Error(activeError.message);
  if (resolvedError) throw new Error(resolvedError.message);

  const active = (activeRows ?? []).map((row) => projectNotificationRow(row, lang));
  const recentResolved = (resolvedRows ?? []).map((row) => projectNotificationRow(row, lang));
  return {
    featureAvailable: true,
    active,
    recentResolved,
    activeCount: active.length,
    unreadActiveCount: active.filter((row) => !row.readAt).length,
  } satisfies ClientAccountNotificationsProjection;
}

export type MarkClientAccountNotificationReadResult =
  | { ok: true; notification: ClientAccountNotificationView }
  | { ok: false; reason: "notification_not_found" | "feature_unavailable" };

export async function markClientAccountNotificationRead(
  supabase: NotificationSupabase,
  input: { clientId: string; notificationId: string },
): Promise<MarkClientAccountNotificationReadResult> {
  const table = await probeClientAccountNotificationsTable(supabase);
  if (!table.available) {
    return { ok: false, reason: "feature_unavailable" };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("client_account_notifications")
    .update({ read_at: now })
    .eq("id", input.notificationId)
    .eq("client_id", input.clientId)
    .eq("status", "active")
    .select("id,account_id,category,status,metadata_safe,created_at,resolved_at,read_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data;
  if (!row) return { ok: false, reason: "notification_not_found" };
  return { ok: true, notification: projectNotificationRow(row) };
}
