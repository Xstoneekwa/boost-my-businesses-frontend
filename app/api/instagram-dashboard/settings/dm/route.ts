import {
  runControlLegacyDmSenderRealSendEnabled,
  runControlOutreachRealSendEnabled,
  runControlWelcomeRealSendEnabled,
  sanitizeRunControlReason,
} from "@/lib/instagram-dashboard/run-control";
import { dmTemplateLengthError, normalizeDmTemplateMessage } from "@/lib/instagram-dashboard/dm-formatting";
import { dmTemplateHasBody, dmTemplateStatusLabel, fetchActiveDmTemplate } from "@/lib/instagram-dashboard/dm-template-store";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readNumber,
  readString,
  requireRelayOrAdmin,
  validateAccountId,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

export type DmDomainPatchPayload = {
  account_id?: unknown;
  welcome_enabled?: unknown;
  welcome_message?: unknown;
  welcome_cap_session?: unknown;
  welcome_cap_day?: unknown;
  outreach_enabled?: unknown;
  outreach_message?: unknown;
  outreach_cap_session?: unknown;
  outreach_cap_day?: unknown;
};

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

export const DEFAULT_WELCOME_DM_DAY_CAP = 10;
export const DEFAULT_OUTREACH_DM_DAY_CAP = 30;

const emptyTemplateReason = "Template message is required when the service is enabled.";

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

async function hasActiveEntitlement(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  featureCode: "welcome",
) {
  const { data: accountRows, error: accountError } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .eq("account_id", accountId)
    .eq("feature_code", featureCode)
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
    .eq("feature_code", featureCode)
    .eq("active", true)
    .limit(10);
  if (clientError) return null;
  return (clientRows ?? []).some(entitlementActiveNow);
}

function entitlementActiveNow(row: SupabaseRecord) {
  if (row.active !== true) return false;
  const validUntil = readString(row.valid_until, "").trim();
  if (!validUntil) return true;
  const time = new Date(validUntil).getTime();
  return Number.isFinite(time) && time > Date.now();
}

async function hasOutreachEntitlement(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { data, error } = await supabase.rpc("client_account_has_outreach_entitlement", {
    p_account_id: accountId,
  });
  if (error) return null;
  return data === true;
}

async function getDmSettings(supabase: ReturnType<typeof createSupabaseClient>, accountId: string) {
  const { data, error } = await supabase
    .from("ig_account_dm_settings")
    .select("account_id,welcome_enabled,outreach_enabled,welcome_template_id,default_outreach_template_id,welcome_per_session_limit,welcome_per_day_limit,outreach_per_session_limit,outreach_per_day_limit,total_dm_per_day_limit")
    .eq("account_id", accountId)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return data;
}

async function getTemplate(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  templateType: "welcome" | "outreach",
  templateId: unknown,
) {
  return fetchActiveDmTemplate(supabase, accountId, templateType, templateId);
}

async function upsertTemplate(
  supabase: ReturnType<typeof createSupabaseClient>,
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

async function buildDmProjection(supabase: ReturnType<typeof createSupabaseClient>, accountId: string) {
  const settings = await getDmSettings(supabase, accountId);
  const [welcomeEntitlement, outreachEntitlement] = await Promise.all([
    hasActiveEntitlement(supabase, accountId, "welcome"),
    hasOutreachEntitlement(supabase, accountId),
  ]);
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
    welcome_entitlement_status: statusLabel(welcomeEntitlement),
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

function projectionToValidationInput(projection: Awaited<ReturnType<typeof buildDmProjection>>): DmDomainValidationInput {
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

async function recordDmAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    actorId: string | null;
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
    message: "DM domain settings saved from admin dashboard.",
    payload: {
      actor_type: "admin",
      actor_id: input.actorId,
      source_surface: "admin_dashboard",
      domain: "dm",
      fields_changed: input.fieldsChanged,
      old_summary: input.oldSummary,
      new_summary: input.newSummary,
    },
    created_at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "DM settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const projection = await buildDmProjection(supabase, accountId);
    return jsonOk(projection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load DM domain settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not load DM domain settings."), 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "DM settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<DmDomainPatchPayload>(request);
    if (!body) return jsonError("Invalid DM settings payload.", 400);

    const accountId = readString(body.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const beforeProjection = await buildDmProjection(supabase, accountId);
    const before = projectionToValidationInput(beforeProjection);
    const after: DmDomainValidationInput = {
      welcomeServiceActive: before.welcomeServiceActive,
      outreachServiceActive: before.outreachServiceActive,
      welcomeEnabled: readBoolean(body.welcome_enabled, before.welcomeEnabled),
      outreachEnabled: readBoolean(body.outreach_enabled, before.outreachEnabled),
      welcomeMessage: normalizeDmTemplateMessage(readString(body.welcome_message, before.welcomeMessage)),
      outreachMessage: normalizeDmTemplateMessage(readString(body.outreach_message, before.outreachMessage)),
      welcomeCapSession: readNonNegativeInteger(body.welcome_cap_session, before.welcomeCapSession),
      welcomeCapDay: readNonNegativeInteger(body.welcome_cap_day, before.welcomeCapDay),
      outreachCapSession: readNonNegativeInteger(body.outreach_cap_session, before.outreachCapSession),
      outreachCapDay: readNonNegativeInteger(body.outreach_cap_day, before.outreachCapDay),
    };

    const validationError = validateDmDomainInput(after);
    if (validationError) return jsonError(validationError, 400);

    const fieldsChanged = dmChangedFields(before, after);
    if (!fieldsChanged.length) {
      return jsonOk({ ...beforeProjection, changed_fields: [] });
    }

    const welcomeTemplateId = fieldsChanged.includes("welcome_template_body")
      ? await upsertTemplate(supabase, accountId, "welcome", readString(beforeProjection.welcome_template_id, ""), after.welcomeMessage)
      : readString(beforeProjection.welcome_template_id, "");
    const outreachTemplateId = fieldsChanged.includes("outreach_template_body")
      ? await upsertTemplate(supabase, accountId, "outreach", readString(beforeProjection.outreach_template_id, ""), after.outreachMessage)
      : readString(beforeProjection.outreach_template_id, "");

    const now = new Date().toISOString();
    const settingsPatch = {
      account_id: accountId,
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
    if (settingsError) return jsonError(sanitizeRunControlReason(settingsError.message, "Could not save DM settings."), 500);

    const actorContext = await getInstagramAdminUserContext();
    await recordDmAudit(supabase, {
      accountId,
      actorId: actorContext?.userId ?? null,
      fieldsChanged,
      oldSummary: redactedDomainSummary(before),
      newSummary: redactedDomainSummary(after),
    }).catch(() => undefined);

    const afterProjection = await buildDmProjection(supabase, accountId);
    return jsonOk({ ...afterProjection, changed_fields: fieldsChanged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save DM domain settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not save DM domain settings."), 500);
  }
}
