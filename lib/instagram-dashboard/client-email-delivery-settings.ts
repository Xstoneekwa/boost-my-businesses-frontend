import {
  CLIENT_EMAIL_ALLOWED_VARIABLES,
  CLIENT_EMAIL_LOCKED_FROM,
  CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES,
  CLIENT_EMAIL_TEST_DEMO_VALUES,
  type ClientEmailAllowedVariable,
} from "./client-email-constants.ts";
import { normalizeCommunicationEmail } from "./client-communication-email.ts";
import { readErrorCode, readErrorMessage } from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";
import {
  findConfirmedPostmarkSenderIdentity,
  getCachedPostmarkSenderSync,
  isPostmarkSenderRefreshRecent,
  projectPostmarkSenderSyncStatus,
  readPostmarkAccountTokenConfigured,
  refreshPostmarkSenderIdentities,
  type PostmarkSenderSyncResult,
} from "./client-email-postmark-sender-sync.ts";

export const TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_KEY = "default";
export const TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_TABLE = "transactional_email_delivery_settings";
export const TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_AUDIT_TABLE = "transactional_email_delivery_settings_audit";

export type TransactionalDeliverySettingsSource = "legacy_default" | "database";

export type ResolvedTransactionalDeliverySettings = {
  activeFromEmail: string;
  supportEmail: string;
  configVersion: number;
  source: TransactionalDeliverySettingsSource;
  schemaReady: boolean;
  updatedAt: string | null;
};

export type TransactionalDeliverySettingsProjection = {
  schemaReady: boolean;
  settings: {
    activeFromEmail: string;
    supportEmail: string;
    configVersion: number;
    source: TransactionalDeliverySettingsSource;
    updatedAt: string | null;
  };
  senderSync: ReturnType<typeof projectPostmarkSenderSyncStatus>;
  uxState:
    | "schema_migration_pending"
    | "sender_sync_unavailable"
    | "no_confirmed_senders"
    | "ready";
  supportEmailEditable: boolean;
  senderChangeAllowed: boolean;
  accountTokenConfigured: boolean;
};

export type TransactionalDeliverySettingsAuditRow = {
  changedAt: string;
  changedBy: string | null;
  previousActiveFromEmail: string;
  newActiveFromEmail: string;
  previousSupportEmail: string;
  newSupportEmail: string;
  previousConfigVersion: number;
  newConfigVersion: number;
};

type SupabaseRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function buildLegacyTransactionalDeliverySettings(): ResolvedTransactionalDeliverySettings {
  return {
    activeFromEmail: CLIENT_EMAIL_LOCKED_FROM,
    supportEmail: CLIENT_EMAIL_LOCKED_FROM,
    configVersion: 1,
    source: "legacy_default",
    schemaReady: false,
    updatedAt: null,
  };
}

export function buildClientEmailDemoValues(
  settings: ResolvedTransactionalDeliverySettings,
  variant: "preview" | "test" = "preview",
): Record<ClientEmailAllowedVariable, string> {
  const base = variant === "test"
    ? { ...CLIENT_EMAIL_TEST_DEMO_VALUES }
    : { ...CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES };
  return {
    ...base,
    support_email: settings.supportEmail,
  };
}

export function buildIntentDeliverySnapshotFields(settings: ResolvedTransactionalDeliverySettings) {
  return {
    from_email: settings.activeFromEmail,
    from_email_snapshot: settings.activeFromEmail,
    support_email_snapshot: settings.supportEmail,
  };
}

export function isTransactionalDeliverySettingsSchemaMissingError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  if (!message.includes(TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_TABLE)) return false;
  const code = readErrorCode(error);
  return message.includes("could not find the table")
    || message.includes("relation")
    || message.includes("does not exist")
    || code === "42P01"
    || code === "PGRST205";
}

export async function probeTransactionalDeliverySettingsSchema(
  supabase: ClientEmailSupabase,
): Promise<{ available: true } | { available: false }> {
  const { error } = await supabase
    .from(TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_TABLE)
    .select("settings_key")
    .eq("settings_key", TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_KEY)
    .limit(1);

  if (!error) return { available: true };
  if (isTransactionalDeliverySettingsSchemaMissingError(error)) return { available: false };
  throw new Error(readErrorMessage(error));
}

function projectSettingsRow(row: SupabaseRecord): ResolvedTransactionalDeliverySettings {
  return {
    activeFromEmail: normalizeCommunicationEmail(readString(row.active_from_email, "")) || CLIENT_EMAIL_LOCKED_FROM,
    supportEmail: normalizeCommunicationEmail(readString(row.support_email, "")) || CLIENT_EMAIL_LOCKED_FROM,
    configVersion: Number(row.config_version) || 1,
    source: "database",
    schemaReady: true,
    updatedAt: readString(row.updated_at, "") || null,
  };
}

export async function resolveTransactionalDeliverySettings(
  supabase: ClientEmailSupabase,
): Promise<ResolvedTransactionalDeliverySettings> {
  const schema = await probeTransactionalDeliverySettingsSchema(supabase);
  if (!schema.available) return buildLegacyTransactionalDeliverySettings();

  const { data, error } = await supabase
    .from(TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_TABLE)
    .select("settings_key,active_from_email,support_email,config_version,updated_at")
    .eq("settings_key", TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    if (isTransactionalDeliverySettingsSchemaMissingError(error)) {
      return buildLegacyTransactionalDeliverySettings();
    }
    throw new Error(readErrorMessage(error));
  }

  if (!data) return buildLegacyTransactionalDeliverySettings();
  return projectSettingsRow(data as SupabaseRecord);
}

export function resolveTransactionalUxState(input: {
  schemaReady: boolean;
  senderSync: ReturnType<typeof projectPostmarkSenderSyncStatus>;
}): TransactionalDeliverySettingsProjection["uxState"] {
  if (!input.schemaReady) return "schema_migration_pending";
  if (input.senderSync.status === "not_configured") return "sender_sync_unavailable";
  if (input.senderSync.status === "no_confirmed_senders") return "no_confirmed_senders";
  if (input.senderSync.status === "ready") return "ready";
  return "sender_sync_unavailable";
}

export async function loadTransactionalDeliverySettingsProjection(
  supabase: ClientEmailSupabase,
  env: Record<string, string | undefined> = process.env,
): Promise<TransactionalDeliverySettingsProjection> {
  const schema = await probeTransactionalDeliverySettingsSchema(supabase);
  const settings = schema.available
    ? await resolveTransactionalDeliverySettings(supabase)
    : buildLegacyTransactionalDeliverySettings();
  const accountTokenConfigured = readPostmarkAccountTokenConfigured(env);
  const senderSync = projectPostmarkSenderSyncStatus({
    accountTokenConfigured,
    cache: getCachedPostmarkSenderSync(),
  });
  const uxState = resolveTransactionalUxState({ schemaReady: schema.available, senderSync });

  return {
    schemaReady: schema.available,
    settings: {
      activeFromEmail: settings.activeFromEmail,
      supportEmail: settings.supportEmail,
      configVersion: settings.configVersion,
      source: settings.source,
      updatedAt: settings.updatedAt,
    },
    senderSync,
    uxState,
    supportEmailEditable: schema.available,
    senderChangeAllowed: schema.available
      && accountTokenConfigured
      && senderSync.status === "ready",
    accountTokenConfigured,
  };
}

export async function executePostmarkSenderIdentityRefresh(
  supabase: ClientEmailSupabase,
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch,
): Promise<
  | { ok: true; projection: TransactionalDeliverySettingsProjection; sync: PostmarkSenderSyncResult & { ok: true } }
  | { ok: false; reason: "account_token_missing" | "provider_error"; message: string }
> {
  const sync = await refreshPostmarkSenderIdentities(env, fetcher);
  if (!sync.ok) {
    return { ok: false, reason: sync.reason, message: sync.message };
  }

  return {
    ok: true,
    sync,
    projection: await loadTransactionalDeliverySettingsProjection(supabase, env),
  };
}

export type PatchTransactionalDeliverySettingsInput = {
  supportEmail?: unknown;
  activeFromEmail?: unknown;
  configVersion?: unknown;
  confirmed?: unknown;
};

export type PatchTransactionalDeliverySettingsResult =
  | { ok: true; settings: ResolvedTransactionalDeliverySettings }
  | {
    ok: false;
    reason:
      | "schema_unavailable"
      | "invalid_support_email"
      | "invalid_active_from_email"
      | "sender_sync_unavailable"
      | "sender_not_confirmed"
      | "stale_sender_refresh"
      | "config_version_mismatch"
      | "confirmation_required"
      | "no_changes";
    message: string;
  };

export async function patchTransactionalDeliverySettings(
  supabase: ClientEmailSupabase,
  input: PatchTransactionalDeliverySettingsInput,
  changedBy: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<PatchTransactionalDeliverySettingsResult> {
  const schema = await probeTransactionalDeliverySettingsSchema(supabase);
  if (!schema.available) {
    return {
      ok: false,
      reason: "schema_unavailable",
      message: "Delivery settings migration is not applied yet.",
    };
  }

  const current = await resolveTransactionalDeliverySettings(supabase);
  const nextSupportEmail = input.supportEmail == null
    ? current.supportEmail
    : normalizeCommunicationEmail(readString(input.supportEmail, ""));
  const nextActiveFromEmail = input.activeFromEmail == null
    ? current.activeFromEmail
    : normalizeCommunicationEmail(readString(input.activeFromEmail, ""));

  if (input.supportEmail != null && !nextSupportEmail) {
    return {
      ok: false,
      reason: "invalid_support_email",
      message: "Support email must be a valid email address.",
    };
  }

  const supportChanged = nextSupportEmail !== current.supportEmail;
  const senderChanged = input.activeFromEmail != null && nextActiveFromEmail !== current.activeFromEmail;

  if (senderChanged) {
    if (input.confirmed !== true) {
      return {
        ok: false,
        reason: "confirmation_required",
        message: "Explicit confirmation is required before changing the active sender.",
      };
    }
    if (!nextActiveFromEmail) {
      return {
        ok: false,
        reason: "invalid_active_from_email",
        message: "Active sender must be a confirmed Postmark identity.",
      };
    }
    if (!readPostmarkAccountTokenConfigured(env)) {
      return {
        ok: false,
        reason: "sender_sync_unavailable",
        message: "Sender identity sync is not configured.",
      };
    }
    const cache = getCachedPostmarkSenderSync();
    if (!cache || !isPostmarkSenderRefreshRecent(cache.refreshedAt)) {
      return {
        ok: false,
        reason: "stale_sender_refresh",
        message: "Refresh sender identities before changing the active sender.",
      };
    }
    if (!findConfirmedPostmarkSenderIdentity(nextActiveFromEmail, cache)) {
      return {
        ok: false,
        reason: "sender_not_confirmed",
        message: "Active sender must match a confirmed Postmark identity from the latest refresh.",
      };
    }
  }

  const expectedVersion = Number(input.configVersion);
  if (Number.isFinite(expectedVersion) && expectedVersion !== current.configVersion) {
    return {
      ok: false,
      reason: "config_version_mismatch",
      message: "Configuration changed elsewhere. Reload settings and try again.",
    };
  }

  if (!supportChanged && !senderChanged) {
    return { ok: false, reason: "no_changes", message: "No delivery settings changes were requested." };
  }

  const now = new Date().toISOString();
  const nextConfigVersion = current.configVersion + 1;
  const { data, error } = await supabase
    .from(TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_TABLE)
    .update({
      active_from_email: nextActiveFromEmail,
      support_email: nextSupportEmail,
      config_version: nextConfigVersion,
      updated_at: now,
      updated_by: changedBy,
    })
    .eq("settings_key", TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_KEY)
    .eq("config_version", current.configVersion)
    .select("settings_key,active_from_email,support_email,config_version,updated_at")
    .maybeSingle();

  if (error) throw new Error(readErrorMessage(error));
  if (!data) {
    return {
      ok: false,
      reason: "config_version_mismatch",
      message: "Configuration changed elsewhere. Reload settings and try again.",
    };
  }

  const { error: auditError } = await supabase
    .from(TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_AUDIT_TABLE)
    .insert({
      settings_key: TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_KEY,
      previous_active_from_email: current.activeFromEmail,
      new_active_from_email: nextActiveFromEmail,
      previous_support_email: current.supportEmail,
      new_support_email: nextSupportEmail,
      previous_config_version: current.configVersion,
      new_config_version: nextConfigVersion,
      changed_at: now,
      changed_by: changedBy,
      change_source: "admin_relay",
    });

  if (auditError) throw new Error(readErrorMessage(auditError));

  return { ok: true, settings: projectSettingsRow(data as SupabaseRecord) };
}

export async function loadTransactionalDeliverySettingsAudit(
  supabase: ClientEmailSupabase,
  limit = 20,
): Promise<{ schemaReady: boolean; items: TransactionalDeliverySettingsAuditRow[] }> {
  const schema = await probeTransactionalDeliverySettingsSchema(supabase);
  if (!schema.available) return { schemaReady: false, items: [] };

  const { data, error } = await supabase
    .from(TRANSACTIONAL_EMAIL_DELIVERY_SETTINGS_AUDIT_TABLE)
    .select("changed_at,changed_by,previous_active_from_email,new_active_from_email,previous_support_email,new_support_email,previous_config_version,new_config_version")
    .order("changed_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isTransactionalDeliverySettingsSchemaMissingError(error)) {
      return { schemaReady: false, items: [] };
    }
    throw new Error(readErrorMessage(error));
  }

  const items = ((data as SupabaseRecord[] | null) ?? []).map((row) => ({
    changedAt: readString(row.changed_at, ""),
    changedBy: readString(row.changed_by, "") || null,
    previousActiveFromEmail: readString(row.previous_active_from_email, ""),
    newActiveFromEmail: readString(row.new_active_from_email, ""),
    previousSupportEmail: readString(row.previous_support_email, ""),
    newSupportEmail: readString(row.new_support_email, ""),
    previousConfigVersion: Number(row.previous_config_version) || 0,
    newConfigVersion: Number(row.new_config_version) || 0,
  }));

  return { schemaReady: true, items };
}

export function assertNoForbiddenDeliverySettingsSecrets(body: Record<string, unknown>): string | null {
  const forbidden = [
    "postmark_account_token",
    "account_token",
    "postmark_server_token",
    "server_token",
    "token",
    "secret",
    "webhook_secret",
    "provider_api_key",
  ];
  for (const field of forbidden) {
    if (field in body && body[field] != null && String(body[field]).trim() !== "") {
      return `Field ${field} is not allowed on delivery settings requests.`;
    }
  }
  return null;
}

export function listAllowedTemplateVariables(): ClientEmailAllowedVariable[] {
  return [...CLIENT_EMAIL_ALLOWED_VARIABLES];
}
