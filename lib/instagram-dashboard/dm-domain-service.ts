import {
  runControlLegacyDmSenderRealSendEnabled,
  runControlOutreachRealSendEnabled,
  runControlWelcomeRealSendEnabled,
} from "@/lib/instagram-dashboard/run-control";
import { dmTemplateLengthError, normalizeDmTemplateMessage } from "@/lib/instagram-dashboard/dm-formatting";
import { dmTemplateHasBody, dmTemplateStatusLabel, fetchActiveDmTemplate } from "@/lib/instagram-dashboard/dm-template-store";
import { readBoolean, readNumber, readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import {
  resolveAccountWelcomeServiceActive,
  welcomeCapacityStatusLabel,
} from "@/lib/instagram-client/account-dm-capacity";
import type { createSupabaseClient } from "@/lib/supabase";

export type DmDomainValidationInput = {
  welcomeServiceActive: boolean;
  outreachServiceActive: boolean;
  welcomeEnabled: boolean;
  outreachEnabled: boolean;
  welcomeMessage: string;
  outreachMessage: string;
  welcomeCapSession: number;
  welcomeCapDay: number;
  outreachCapSession: number;
  outreachCapDay: number;
};

export type DmDomainPatchInput = {
  welcome_enabled?: unknown;
  welcome_message?: unknown;
  welcome_cap_session?: unknown;
  welcome_cap_day?: unknown;
  outreach_enabled?: unknown;
  outreach_message?: unknown;
  outreach_cap_session?: unknown;
  outreach_cap_day?: unknown;
};

export const DEFAULT_WELCOME_DM_DAY_CAP = 10;
export const DEFAULT_OUTREACH_DM_DAY_CAP = 30;

const emptyTemplateReason = "Template message is required when the service is enabled.";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

function boolStatus(enabled: boolean | null) {
  if (enabled === null) return "Unknown";
  return enabled ? "Enabled" : "Disabled";
}

function statusLabel(active: boolean | null) {
  if (active === null) return "Unknown";
  return active ? "Active" : "Missing";
}

function readNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = readNumber(value, fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readProductDefaultDayCap(value: unknown, productDefault: number) {
  return readNonNegativeInteger(value, productDefault);
}

function hasBody(value: string) {
  return dmTemplateHasBody(value);
}

function templateStatus(body: string) {
  return dmTemplateStatusLabel(body);
}

function changed<T>(before: T, after: T) {
  return before !== after;
}

export function validateDmDomainInput(input: DmDomainValidationInput) {
  if (!input.welcomeServiceActive && input.welcomeEnabled) {
    return "Welcome service is not active for this account.";
  }
  if (!input.outreachServiceActive && input.outreachEnabled) {
    return "Outreach service is not active for this account.";
  }
  if (input.welcomeEnabled && !hasBody(input.welcomeMessage)) {
    return emptyTemplateReason;
  }
  if (input.outreachEnabled && !hasBody(input.outreachMessage)) {
    return emptyTemplateReason;
  }
  const welcomeLengthError = dmTemplateLengthError("Welcome", input.welcomeMessage);
  if (welcomeLengthError) return welcomeLengthError;
  const outreachLengthError = dmTemplateLengthError("Outreach", input.outreachMessage);
  if (outreachLengthError) return outreachLengthError;
  if (input.welcomeEnabled && input.welcomeCapSession < 1) {
    return "Welcome session cap must be at least 1 when Welcome is enabled.";
  }
  if (input.welcomeEnabled && input.welcomeCapDay < 1) {
    return "Welcome day cap must be at least 1 when Welcome is enabled.";
  }
  if (input.welcomeCapDay > DEFAULT_WELCOME_DM_DAY_CAP) {
    return `welcome_daily_cap_exceeded: Welcome day cap cannot exceed ${DEFAULT_WELCOME_DM_DAY_CAP}.`;
  }
  if (input.welcomeEnabled && input.welcomeCapSession > input.welcomeCapDay) {
    return "session_cap_exceeds_day_cap: Welcome session cap cannot exceed Welcome day cap.";
  }
  if (input.outreachEnabled && (input.outreachCapSession < 1 || input.outreachCapDay < 1)) {
    return "Outreach caps must be at least 1 when Outreach is enabled.";
  }
  if (input.outreachCapDay > DEFAULT_OUTREACH_DM_DAY_CAP) {
    return `outreach_daily_cap_exceeded: Outreach day cap cannot exceed ${DEFAULT_OUTREACH_DM_DAY_CAP}.`;
  }
  if (input.outreachEnabled && input.outreachCapSession > input.outreachCapDay) {
    return "session_cap_exceeds_day_cap: Outreach session cap cannot exceed Outreach day cap.";
  }
  return null;
}

export function dmChangedFields(before: DmDomainValidationInput, after: DmDomainValidationInput) {
  const fields: string[] = [];
  if (changed(before.welcomeEnabled, after.welcomeEnabled)) fields.push("welcome_enabled");
  if (changed(before.welcomeMessage, after.welcomeMessage)) fields.push("welcome_template_body");
  if (changed(before.welcomeCapSession, after.welcomeCapSession)) fields.push("welcome_per_session_limit");
  if (changed(before.welcomeCapDay, after.welcomeCapDay)) fields.push("welcome_per_day_limit");
  if (changed(before.outreachEnabled, after.outreachEnabled)) fields.push("outreach_enabled");
  if (changed(before.outreachMessage, after.outreachMessage)) fields.push("outreach_template_body");
  if (changed(before.outreachCapSession, after.outreachCapSession)) fields.push("outreach_per_session_limit");
  if (changed(before.outreachCapDay, after.outreachCapDay)) fields.push("outreach_per_day_limit");
  return fields;
}

function redactedDomainSummary(input: DmDomainValidationInput) {
  return {
    welcome_enabled: input.welcomeEnabled,
    welcome_template_status: templateStatus(input.welcomeMessage),
    welcome_per_session_limit: input.welcomeCapSession,
    welcome_per_day_limit: input.welcomeCapDay,
    outreach_enabled: input.outreachEnabled,
    outreach_template_status: templateStatus(input.outreachMessage),
    outreach_per_session_limit: input.outreachCapSession,
    outreach_per_day_limit: input.outreachCapDay,
  };
}

function entitlementActiveNow(row: SupabaseRecord) {
  if (row.active !== true) return false;
  const validUntil = readString(row.valid_until, "").trim();
  if (!validUntil) return true;
  const time = new Date(validUntil).getTime();
  return Number.isFinite(time) && time > Date.now();
}

export async function hasWelcomeEntitlement(supabase: SupabaseClient, accountId: string) {
  const { data: accountRows, error: accountError } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .eq("account_id", accountId)
    .eq("feature_code", "welcome")
    .eq("active", true)
    .limit(10);
  if (accountError) return null;
  if ((accountRows ?? []).some(entitlementActiveNow)) return true;

  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .limit(10);
  if (linkError) return null;
  const clientIds = Array.from(new Set((links ?? []).map((row) => readString(row.client_id, "").trim()).filter(Boolean)));
  if (!clientIds.length) return false;

  const { data: clientRows, error: clientError } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .in("client_id", clientIds)
    .is("account_id", null)
    .eq("feature_code", "welcome")
    .eq("active", true)
    .limit(10);
  if (clientError) return null;
  return (clientRows ?? []).some(entitlementActiveNow);
}

export async function hasOutreachEntitlement(supabase: SupabaseClient, accountId: string) {
  const { data, error } = await supabase.rpc("client_account_has_outreach_entitlement", {
    p_account_id: accountId,
  });
  if (error) return null;
  return data === true;
}

async function getDmSettings(supabase: SupabaseClient, accountId: string) {
  const { data, error } = await supabase
    .from("ig_account_dm_settings")
    .select("account_id,welcome_enabled,outreach_enabled,welcome_template_id,default_outreach_template_id,welcome_per_session_limit,welcome_per_day_limit,outreach_per_session_limit,outreach_per_day_limit,total_dm_per_day_limit")
    .eq("account_id", accountId)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return data;
}

async function getTemplate(
  supabase: SupabaseClient,
  accountId: string,
  templateType: "welcome" | "outreach",
  templateId: unknown,
) {
  return fetchActiveDmTemplate(supabase, accountId, templateType, templateId);
}

async function upsertTemplate(
  supabase: SupabaseClient,
  accountId: string,
  templateType: "welcome" | "outreach",
  existingTemplateId: string,
  body: string,
) {
  const now = new Date().toISOString();
  const payload = {
    account_id: accountId,
    template_type: templateType,
    name: templateType === "welcome" ? "Welcome default" : "Outreach default",
    body,
    is_default: true,
    active: true,
    updated_at: now,
  };

  if (existingTemplateId) {
    const { data, error } = await supabase
      .from("ig_dm_templates")
      .update(payload)
      .eq("id", existingTemplateId)
      .eq("account_id", accountId)
      .select("id,body")
      .maybeSingle<SupabaseRecord>();
    if (error) throw new Error(error.message);
    if (data) return readString(data.id, "");
  }

  const { data, error } = await supabase
    .from("ig_dm_templates")
    .insert(payload)
    .select("id,body")
    .single<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return readString(data.id, "");
}

export type DmDomainProjection = Awaited<ReturnType<typeof buildDmProjection>>;

export async function buildDmProjection(supabase: SupabaseClient, accountId: string) {
  const settings = await getDmSettings(supabase, accountId);
  const [welcomeCapacity, outreachEntitlement] = await Promise.all([
    resolveAccountWelcomeServiceActive(supabase, accountId),
    hasOutreachEntitlement(supabase, accountId),
  ]);
  const welcomeEntitlement = welcomeCapacity.active;
  const [welcomeTemplate, outreachTemplate] = await Promise.all([
    getTemplate(supabase, accountId, "welcome", settings?.welcome_template_id),
    getTemplate(supabase, accountId, "outreach", settings?.default_outreach_template_id),
  ]);
  const legacyGate = runControlLegacyDmSenderRealSendEnabled();

  const welcomeMessage = readString(welcomeTemplate?.body, "");
  const outreachMessage = readString(outreachTemplate?.body, "");
  const domainInput: DmDomainValidationInput = {
    welcomeServiceActive: welcomeEntitlement === true,
    outreachServiceActive: outreachEntitlement === true,
    welcomeEnabled: settings?.welcome_enabled === true,
    outreachEnabled: settings?.outreach_enabled === true,
    welcomeMessage,
    outreachMessage,
    welcomeCapSession: readNonNegativeInteger(settings?.welcome_per_session_limit, 0),
    welcomeCapDay: readProductDefaultDayCap(settings?.welcome_per_day_limit, DEFAULT_WELCOME_DM_DAY_CAP),
    outreachCapSession: readNonNegativeInteger(settings?.outreach_per_session_limit, 0),
    outreachCapDay: readProductDefaultDayCap(settings?.outreach_per_day_limit, DEFAULT_OUTREACH_DM_DAY_CAP),
  };

  return {
    account_id: accountId,
    welcome_service_active: domainInput.welcomeServiceActive,
    outreach_service_active: domainInput.outreachServiceActive,
    welcome_entitlement_status: welcomeCapacityStatusLabel(welcomeCapacity),
    outreach_entitlement_status: statusLabel(outreachEntitlement),
    welcome_enabled: domainInput.welcomeEnabled,
    outreach_enabled: domainInput.outreachEnabled,
    welcome_message: welcomeMessage,
    outreach_message: outreachMessage,
    welcome_template_id: readString(welcomeTemplate?.id, ""),
    outreach_template_id: readString(outreachTemplate?.id, ""),
    welcome_template_status: templateStatus(welcomeMessage),
    outreach_template_status: templateStatus(outreachMessage),
    welcome_cap_session: domainInput.welcomeCapSession,
    welcome_cap_day: domainInput.welcomeCapDay,
    outreach_cap_session: domainInput.outreachCapSession,
    outreach_cap_day: domainInput.outreachCapDay,
    welcome_real_send_status: boolStatus(runControlWelcomeRealSendEnabled()),
    outreach_real_send_status: boolStatus(runControlOutreachRealSendEnabled()),
    legacy_dm_gate_status: legacyGate === null ? "Not configured" : `Legacy global ${boolStatus(legacyGate).toLowerCase()} (read-only)`,
    save_ready: true,
    validation_error: validateDmDomainInput(domainInput),
  };
}

export function projectionToValidationInput(projection: DmDomainProjection): DmDomainValidationInput {
  return {
    welcomeServiceActive: projection.welcome_service_active,
    outreachServiceActive: projection.outreach_service_active,
    welcomeEnabled: projection.welcome_enabled,
    outreachEnabled: projection.outreach_enabled,
    welcomeMessage: projection.welcome_message,
    outreachMessage: projection.outreach_message,
    welcomeCapSession: projection.welcome_cap_session,
    welcomeCapDay: projection.welcome_cap_day,
    outreachCapSession: projection.outreach_cap_session,
    outreachCapDay: projection.outreach_cap_day,
  };
}

function applyProductDefaultsWhenEnabling(after: DmDomainValidationInput): DmDomainValidationInput {
  const next = { ...after };
  if (next.welcomeEnabled && next.welcomeCapSession < 1) {
    next.welcomeCapSession = Math.min(DEFAULT_WELCOME_DM_DAY_CAP, 10);
  }
  if (next.welcomeEnabled && next.welcomeCapDay < 1) {
    next.welcomeCapDay = DEFAULT_WELCOME_DM_DAY_CAP;
  }
  if (next.outreachEnabled && next.outreachCapSession < 1) {
    next.outreachCapSession = 5;
  }
  if (next.outreachEnabled && next.outreachCapDay < 1) {
    next.outreachCapDay = DEFAULT_OUTREACH_DM_DAY_CAP;
  }
  return next;
}

export async function recordDmAudit(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    actorId: string | null;
    actorType: "admin" | "client";
    sourceSurface: string;
    fieldsChanged: string[];
    oldSummary: Record<string, unknown>;
    newSummary: Record<string, unknown>;
  },
) {
  await supabase.from("ig_action_logs").insert({
    account_id: input.accountId,
    run_id: null,
    target_username: null,
    action_type: "dm_domain_settings_saved",
    status: "success",
    message: input.actorType === "client"
      ? "DM domain settings saved from client dashboard."
      : "DM domain settings saved from admin dashboard.",
    payload: {
      actor_type: input.actorType,
      actor_id: input.actorId,
      source_surface: input.sourceSurface,
      domain: "dm",
      fields_changed: input.fieldsChanged,
      old_summary: input.oldSummary,
      new_summary: input.newSummary,
    },
    created_at: new Date().toISOString(),
  });
}

export async function saveDmDomainPatch(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    patch: DmDomainPatchInput;
    actorId?: string | null;
    actorType?: "admin" | "client";
    sourceSurface?: string;
    allowedFields?: Array<keyof DmDomainPatchInput>;
  },
) {
  const beforeProjection = await buildDmProjection(supabase, input.accountId);
  const before = projectionToValidationInput(beforeProjection);
  const patch = input.patch;
  const allowed = input.allowedFields ? new Set(input.allowedFields) : null;

  const afterBase: DmDomainValidationInput = {
    welcomeServiceActive: before.welcomeServiceActive,
    outreachServiceActive: before.outreachServiceActive,
    welcomeEnabled: allowed && !allowed.has("welcome_enabled")
      ? before.welcomeEnabled
      : readBoolean(patch.welcome_enabled, before.welcomeEnabled),
    outreachEnabled: allowed && !allowed.has("outreach_enabled")
      ? before.outreachEnabled
      : readBoolean(patch.outreach_enabled, before.outreachEnabled),
    welcomeMessage: allowed && !allowed.has("welcome_message")
      ? before.welcomeMessage
      : normalizeDmTemplateMessage(readString(patch.welcome_message, before.welcomeMessage)),
    outreachMessage: allowed && !allowed.has("outreach_message")
      ? before.outreachMessage
      : normalizeDmTemplateMessage(readString(patch.outreach_message, before.outreachMessage)),
    welcomeCapSession: allowed && !allowed.has("welcome_cap_session")
      ? before.welcomeCapSession
      : readNonNegativeInteger(patch.welcome_cap_session, before.welcomeCapSession),
    welcomeCapDay: allowed && !allowed.has("welcome_cap_day")
      ? before.welcomeCapDay
      : readNonNegativeInteger(patch.welcome_cap_day, before.welcomeCapDay),
    outreachCapSession: allowed && !allowed.has("outreach_cap_session")
      ? before.outreachCapSession
      : readNonNegativeInteger(patch.outreach_cap_session, before.outreachCapSession),
    outreachCapDay: allowed && !allowed.has("outreach_cap_day")
      ? before.outreachCapDay
      : readNonNegativeInteger(patch.outreach_cap_day, before.outreachCapDay),
  };

  const after = applyProductDefaultsWhenEnabling(afterBase);
  const validationError = validateDmDomainInput(after);
  if (validationError) {
    return { ok: false as const, status: 400, error: validationError };
  }

  const fieldsChanged = dmChangedFields(before, after);
  if (!fieldsChanged.length) {
    return { ok: true as const, projection: beforeProjection, changedFields: [] as string[] };
  }

  const welcomeTemplateId = fieldsChanged.includes("welcome_template_body")
    ? await upsertTemplate(supabase, input.accountId, "welcome", readString(beforeProjection.welcome_template_id, ""), after.welcomeMessage)
    : readString(beforeProjection.welcome_template_id, "");
  const outreachTemplateId = fieldsChanged.includes("outreach_template_body")
    ? await upsertTemplate(supabase, input.accountId, "outreach", readString(beforeProjection.outreach_template_id, ""), after.outreachMessage)
    : readString(beforeProjection.outreach_template_id, "");

  const now = new Date().toISOString();
  const settingsPatch = {
    account_id: input.accountId,
    welcome_enabled: after.welcomeEnabled,
    outreach_enabled: after.outreachEnabled,
    welcome_template_id: welcomeTemplateId || null,
    default_outreach_template_id: outreachTemplateId || null,
    welcome_per_session_limit: after.welcomeCapSession,
    welcome_per_day_limit: after.welcomeCapDay,
    outreach_per_session_limit: after.outreachCapSession,
    outreach_per_day_limit: after.outreachCapDay,
    updated_at: now,
  };

  const { error: settingsError } = await supabase
    .from("ig_account_dm_settings")
    .upsert(settingsPatch, { onConflict: "account_id" });
  if (settingsError) {
    return { ok: false as const, status: 500, error: settingsError.message };
  }

  const actorType = input.actorType ?? "admin";
  const sourceSurface = input.sourceSurface ?? (actorType === "client" ? "client_dashboard" : "admin_dashboard");
  await recordDmAudit(supabase, {
    accountId: input.accountId,
    actorId: input.actorId ?? null,
    actorType,
    sourceSurface,
    fieldsChanged,
    oldSummary: redactedDomainSummary(before),
    newSummary: redactedDomainSummary(after),
  }).catch(() => undefined);

  const afterProjection = await buildDmProjection(supabase, input.accountId);
  return { ok: true as const, projection: afterProjection, changedFields: fieldsChanged };
}

export { normalizeDmTemplateMessage };
