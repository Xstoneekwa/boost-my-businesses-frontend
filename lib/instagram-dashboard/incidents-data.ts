import { createSupabaseClient } from "@/lib/supabase";
import {
  evaluateRunStartEligibility,
  insertManualRunAudit,
  type RunStartBlockReason,
} from "./run-control";

export type IncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";
export type IncidentSeverity = "info" | "warning" | "error" | "critical";
export type IncidentActionName =
  | "acknowledge"
  | "resolve"
  | "keep_paused"
  | "manual_retry";

export type IncidentListFilters = {
  status?: string | null;
  severity?: string | null;
  reason?: string | null;
  accountId?: string | null;
  clientId?: string | null;
  deviceId?: string | null;
  hostMachine?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
  offset?: number;
};

type SupabaseRecord = Record<string, unknown>;

const ACTIVE_INCIDENT_STATUSES = ["open", "acknowledged"] as const;
const FORBIDDEN_EVIDENCE_TERMS = [
  "password",
  "secret",
  "token",
  "credential",
  "authorization",
  "cookie",
  "vault",
  "webhook",
  "xml",
  "screenshot",
  "adb_serial",
  "device_udid",
  "service_role",
  "stack_trace",
];

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function hostFromWorkerId(workerId: string | null | undefined) {
  const normalized = readString(workerId).trim().toLowerCase();
  if (!normalized.startsWith("run-dispatcher:")) return null;
  const host = normalized.slice("run-dispatcher:".length).trim();
  return host || null;
}

export function redactIncidentEvidence(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as SupabaseRecord)) {
    const normalizedKey = key.toLowerCase();
    if (FORBIDDEN_EVIDENCE_TERMS.some((term) => normalizedKey.includes(term))) continue;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const normalizedValue = trimmed.toLowerCase();
      if (FORBIDDEN_EVIDENCE_TERMS.some((term) => normalizedValue.includes(term))) continue;
      out[key] = trimmed.slice(0, 500);
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    } else if (typeof raw === "boolean") {
      out[key] = raw;
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const nested = redactIncidentEvidence(raw);
      if (Object.keys(nested).length) out[key] = nested;
    }
  }
  return out;
}

function mapIncidentRow(
  row: SupabaseRecord,
  context: {
    clientName?: string | null;
    deviceLabel?: string | null;
    hostMachine?: string | null;
    cloneLabel?: string | null;
    packageName?: string | null;
  } = {},
) {
  const metadata = redactIncidentEvidence(row.metadata);
  return {
    id: readString(row.id),
    status: readString(row.status, "open") as IncidentStatus,
    severity: readString(row.severity, "warning") as IncidentSeverity,
    incidentType: readString(row.incident_type),
    dedupeKey: readString(row.dedupe_key),
    reason: readString(row.reason) || readString(row.failure_reason),
    failureReason: readString(row.failure_reason),
    actionRequired: readString(row.action_required),
    safeClientMessage: readString(row.safe_client_message),
    assistantMessage: readString(row.assistant_message),
    adminMessage: readString(row.admin_message),
    accountId: readString(row.account_id) || null,
    accountUsername: readString(row.account_username) || null,
    clientId: readString(row.client_id) || null,
    clientName: context.clientName ?? null,
    runId: readString(row.run_id) || null,
    assignmentId: readString(row.assignment_id) || null,
    deviceId: readString(row.device_id) || null,
    deviceLabel: context.deviceLabel ?? null,
    hostMachine: context.hostMachine
      ?? readString(metadata.host_machine)
      ?? hostFromWorkerId(readString(metadata.execution_worker_id))
      ?? hostFromWorkerId(readString(metadata.worker_id))
      ?? null,
    cloneId: readString(row.clone_id) || null,
    cloneLabel: context.cloneLabel ?? null,
    packageName: context.packageName ?? null,
    source: readString(row.source) || null,
    occurrenceCount: readInteger(row.occurrence_count, 1),
    createdAt: readString(row.created_at) || null,
    updatedAt: readString(row.updated_at) || null,
    firstSeenAt: readString(row.first_seen_at) || null,
    lastSeenAt: readString(row.last_seen_at) || null,
    acknowledgedAt: readString(row.acknowledged_at) || null,
    resolvedAt: readString(row.resolved_at) || null,
    evidence: metadata,
    requestId: readString(metadata.request_id) || null,
    executionWorkerId: readString(metadata.execution_worker_id) || null,
    triggerSource: readString(metadata.trigger_source) || null,
    deepLinks: {
      account: row.account_id ? `/instagram-dashboard/accounts/${readString(row.account_id)}?from=incidents` : null,
      device: row.device_id ? `/instagram-dashboard/devices?device_id=${readString(row.device_id)}` : null,
      run: row.run_id ? `/instagram-dashboard/activity-log?run_id=${readString(row.run_id)}` : null,
      incident: row.id ? `/instagram-dashboard/incidents/${readString(row.id)}` : null,
    },
  };
}

async function loadIncidentContextMaps(rows: SupabaseRecord[]) {
  const supabase = createSupabaseClient();
  const clientIds = [...new Set(rows.map((row) => readString(row.client_id)).filter(Boolean))];
  const deviceIds = [...new Set(rows.map((row) => readString(row.device_id)).filter(Boolean))];
  const cloneIds = [...new Set(rows.map((row) => readString(row.clone_id)).filter(Boolean))];

  const clients = new Map<string, string>();
  if (clientIds.length) {
    const { data } = await supabase.from("clients").select("id,name").in("id", clientIds);
    for (const row of (data ?? []) as SupabaseRecord[]) {
      clients.set(readString(row.id), readString(row.name));
    }
  }

  const devices = new Map<string, { label: string; hostMachine: string | null }>();
  if (deviceIds.length) {
    const { data } = await supabase.from("phone_devices").select("id,name,host_machine").in("id", deviceIds);
    for (const row of (data ?? []) as SupabaseRecord[]) {
      devices.set(readString(row.id), {
        label: readString(row.name) || readString(row.id).slice(0, 8),
        hostMachine: readString(row.host_machine) || null,
      });
    }
  }

  const clones = new Map<string, { label: string; packageName: string | null }>();
  if (cloneIds.length) {
    const { data } = await supabase
      .from("phone_clones")
      .select("id,clone_label,package_name")
      .in("id", cloneIds);
    for (const row of (data ?? []) as SupabaseRecord[]) {
      clones.set(readString(row.id), {
        label: readString(row.clone_label) || readString(row.id).slice(0, 8),
        packageName: readString(row.package_name) || null,
      });
    }
  }

  return { clients, devices, clones };
}

export async function accountHasOpenBlockingIncident(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_incidents")
    .select("id,reason,status,severity")
    .eq("account_id", accountId)
    .in("status", [...ACTIVE_INCIDENT_STATUSES])
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SupabaseRecord[])[0] ?? null;
}

export async function getIncidentsOverview(filters: IncidentListFilters = {}) {
  const supabase = createSupabaseClient();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 250);
  const offset = Math.max(filters.offset ?? 0, 0);

  let query = supabase
    .from("account_incidents")
    .select("*", { count: "exact" })
    .order("last_seen_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const status = readString(filters.status).trim();
  if (status) {
    const statuses = status.split(",").map((item) => item.trim()).filter(Boolean);
    query = statuses.length > 1 ? query.in("status", statuses) : query.eq("status", statuses[0]);
  }
  const severity = readString(filters.severity).trim();
  if (severity) query = query.eq("severity", severity);
  const reason = readString(filters.reason).trim();
  if (reason) query = query.ilike("reason", `%${reason}%`);
  const accountId = readString(filters.accountId).trim();
  if (accountId) query = query.eq("account_id", accountId);
  const clientId = readString(filters.clientId).trim();
  if (clientId) query = query.eq("client_id", clientId);
  const deviceId = readString(filters.deviceId).trim();
  if (deviceId) query = query.eq("device_id", deviceId);
  if (filters.since) query = query.gte("last_seen_at", filters.since);
  if (filters.until) query = query.lte("last_seen_at", filters.until);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as SupabaseRecord[];
  const contextMaps = await loadIncidentContextMaps(rows);
  const hostMachine = readString(filters.hostMachine).trim().toLowerCase();

  const incidents = rows
    .map((row) => {
      const deviceIdValue = readString(row.device_id);
      const cloneIdValue = readString(row.clone_id);
      const clientIdValue = readString(row.client_id);
      const device = deviceIdValue ? contextMaps.devices.get(deviceIdValue) : undefined;
      const clone = cloneIdValue ? contextMaps.clones.get(cloneIdValue) : undefined;
      return mapIncidentRow(row, {
        clientName: clientIdValue ? contextMaps.clients.get(clientIdValue) ?? null : null,
        deviceLabel: device?.label ?? null,
        hostMachine: device?.hostMachine ?? null,
        cloneLabel: clone?.label ?? null,
        packageName: clone?.packageName ?? null,
      });
    })
    .filter((incident) => {
      if (!hostMachine) return true;
      return (incident.hostMachine ?? "").toLowerCase() === hostMachine;
    });

  const openCount = incidents.filter((item) => ACTIVE_INCIDENT_STATUSES.includes(item.status as typeof ACTIVE_INCIDENT_STATUSES[number])).length;

  return {
    generatedAt: new Date().toISOString(),
    incidents,
    summary: {
      total: count ?? incidents.length,
      openCount,
      returned: incidents.length,
      offset,
      limit,
    },
    filters: {
      status: status || null,
      severity: severity || null,
      reason: reason || null,
      accountId: accountId || null,
      clientId: clientId || null,
      deviceId: deviceId || null,
      hostMachine: hostMachine || null,
      since: filters.since ?? null,
      until: filters.until ?? null,
    },
  };
}

async function loadIncidentTimeline(accountId: string | null, incidentId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_action_logs")
    .select("id,action_type,status,message,created_at,payload")
    .contains("payload", { incident_id: incidentId })
    .order("created_at", { ascending: false })
    .limit(40);
  if (error && accountId) {
    const fallback = await supabase
      .from("ig_action_logs")
      .select("id,action_type,status,message,created_at,payload")
      .eq("account_id", accountId)
      .ilike("action_type", "incident_%")
      .order("created_at", { ascending: false })
      .limit(40);
    if (fallback.error) return [];
    return ((fallback.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: readString(row.id),
      actionType: readString(row.action_type),
      status: readString(row.status),
      message: readString(row.message),
      createdAt: readString(row.created_at),
      payload: redactIncidentEvidence(row.payload),
    }));
  }
  if (error) return [];
  return ((data ?? []) as SupabaseRecord[]).map((row) => ({
    id: readString(row.id),
    actionType: readString(row.action_type),
    status: readString(row.status),
    message: readString(row.message),
    createdAt: readString(row.created_at),
    payload: redactIncidentEvidence(row.payload),
  }));
}

async function loadIncidentNotifications(incidentId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_incident_notifications")
    .select("id,channel,status,delivery_key,attempt_count,last_attempt_at,delivered_at,last_error,created_at,updated_at")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return ((data ?? []) as SupabaseRecord[]).map((row) => ({
    id: readString(row.id),
    channel: readString(row.channel),
    status: readString(row.status),
    deliveryKey: readString(row.delivery_key),
    attemptCount: readInteger(row.attempt_count, 0),
    lastAttemptAt: readString(row.last_attempt_at) || null,
    deliveredAt: readString(row.delivered_at) || null,
    lastError: readString(row.last_error).slice(0, 240) || null,
    createdAt: readString(row.created_at) || null,
    updatedAt: readString(row.updated_at) || null,
  }));
}

async function loadLinkedDashboardActions(incidentId: string, accountId: string | null) {
  const supabase = createSupabaseClient();
  let query = supabase
    .from("account_dashboard_actions")
    .select("id,action_type,status,severity,title,blocking_campaign,updated_at")
    .eq("incident_id", incidentId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (!incidentId && accountId) {
    query = supabase
      .from("account_dashboard_actions")
      .select("id,action_type,status,severity,title,blocking_campaign,updated_at")
      .eq("account_id", accountId)
      .in("status", ["pending", "acknowledged", "pending_verification"])
      .order("updated_at", { ascending: false })
      .limit(20);
  }
  const { data, error } = await query;
  if (error) return [];
  return ((data ?? []) as SupabaseRecord[]).map((row) => ({
    id: readString(row.id),
    actionType: readString(row.action_type),
    status: readString(row.status),
    severity: readString(row.severity),
    title: readString(row.title),
    blockingCampaign: row.blocking_campaign === true,
    updatedAt: readString(row.updated_at) || null,
  }));
}

export async function getIncidentDetail(incidentId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_incidents")
    .select("*")
    .eq("id", incidentId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as SupabaseRecord;
  const contextMaps = await loadIncidentContextMaps([row]);
  const deviceIdValue = readString(row.device_id);
  const cloneIdValue = readString(row.clone_id);
  const clientIdValue = readString(row.client_id);
  const device = deviceIdValue ? contextMaps.devices.get(deviceIdValue) : undefined;
  const clone = cloneIdValue ? contextMaps.clones.get(cloneIdValue) : undefined;
  const incident = mapIncidentRow(row, {
    clientName: clientIdValue ? contextMaps.clients.get(clientIdValue) ?? null : null,
    deviceLabel: device?.label ?? null,
    hostMachine: device?.hostMachine ?? null,
    cloneLabel: clone?.label ?? null,
    packageName: clone?.packageName ?? null,
  });

  const [timeline, notifications, dashboardActions] = await Promise.all([
    loadIncidentTimeline(incident.accountId, incident.id),
    loadIncidentNotifications(incident.id),
    loadLinkedDashboardActions(incident.id, incident.accountId),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    incident,
    timeline,
    notifications,
    dashboardActions,
    audit: {
      resolutionTrailPresent: incident.status === "resolved",
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt,
    },
  };
}

async function insertIncidentAudit({
  accountId,
  incidentId,
  actionType,
  actorType,
  actorId,
  source,
  status,
  message,
  payload,
}: {
  accountId: string | null;
  incidentId: string;
  actionType: string;
  actorType: string;
  actorId: string | null;
  source: string;
  status: string;
  message: string;
  payload: Record<string, unknown>;
}) {
  const supabase = createSupabaseClient();
  try {
    await supabase.from("ig_action_logs").insert({
      account_id: accountId,
      run_id: null,
      target_username: null,
      action_type: actionType,
      status,
      message,
      payload: redactIncidentEvidence({
        ...payload,
        incident_id: incidentId,
        actor_type: actorType,
        actor_id: actorId,
        source,
      }),
      created_at: new Date().toISOString(),
    });
  } catch {
    // Audit is best-effort; incident row remains authoritative.
  }
}

async function cancelPendingAutoRestartRequests(accountId: string, reason: string) {
  const supabase = createSupabaseClient();
  const { data } = await supabase
    .from("account_run_requests")
    .select("id,status,metadata_safe")
    .eq("account_id", accountId)
    .in("status", ["queued", "claimed", "starting", "running"])
    .limit(50);
  const rows = (data ?? []) as SupabaseRecord[];
  for (const row of rows) {
    const meta = row.metadata_safe && typeof row.metadata_safe === "object" ? row.metadata_safe as SupabaseRecord : {};
    if (!meta.auto_restart) continue;
    await supabase.rpc("cancel_account_run_request", {
      p_request_id: readString(row.id),
      p_reason: reason.slice(0, 240),
    });
  }
}

export async function executeIncidentAction(input: {
  incidentId: string;
  action: IncidentActionName;
  actorType: "admin" | "botapp" | "ops";
  actorId?: string | null;
  source?: string;
  resolutionNote?: string | null;
  resumeScheduling?: boolean;
  requestedRunType?: string | null;
  idempotencyKey?: string | null;
}) {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();
  const action = input.action;
  const source = readString(input.source, input.actorType === "botapp" ? "botapp_relay" : "admin_dashboard");
  const resolutionNote = readString(input.resolutionNote).trim().slice(0, 500);

  const { data: existing, error: existingError } = await supabase
    .from("account_incidents")
    .select("*")
    .eq("id", input.incidentId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) return { ok: false as const, reason: "incident_not_found" };

  const row = existing as SupabaseRecord;
  const accountId = readString(row.account_id) || null;
  const currentStatus = readString(row.status, "open") as IncidentStatus;
  const previousMetadata = redactIncidentEvidence(row.metadata);

  const actionIdempotencyKey = readString(input.idempotencyKey).trim()
    || `incident-${action}:${input.incidentId}`;

  if (action === "acknowledge") {
    if (!["open", "acknowledged"].includes(currentStatus)) {
      return { ok: false as const, reason: "incident_not_acknowledgeable" };
    }
    if (
      readString(previousMetadata.last_action_idempotency_key) === actionIdempotencyKey
      && currentStatus === "acknowledged"
    ) {
      return { ok: true as const, action, incidentId: input.incidentId, status: "acknowledged", resumedScheduling: false, idempotent: true };
    }
    const { data: updated, error } = await supabase
      .from("account_incidents")
      .update({
        status: "acknowledged",
        acknowledged_at: now,
        acknowledged_by: input.actorId ?? null,
        updated_at: now,
        metadata: {
          ...previousMetadata,
          last_human_action: "acknowledge",
          last_human_action_at: now,
          last_human_actor_type: input.actorType,
          last_action_idempotency_key: actionIdempotencyKey,
          resolution_note: resolutionNote || previousMetadata.resolution_note || null,
        },
      })
      .eq("id", input.incidentId)
      .in("status", ["open", "acknowledged"])
      .select("id,status,acknowledged_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) return { ok: false as const, reason: "incident_not_acknowledgeable" };
    await insertIncidentAudit({
      accountId,
      incidentId: input.incidentId,
      actionType: "incident_acknowledged",
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      source,
      status: "success",
      message: "incident_acknowledged",
      payload: { resolution_note: resolutionNote || null },
    });
    return { ok: true as const, action, incidentId: input.incidentId, status: "acknowledged", resumedScheduling: false };
  }

  if (action === "resolve") {
    if (!["open", "acknowledged"].includes(currentStatus)) {
      return { ok: false as const, reason: "incident_not_resolvable" };
    }
    if (!resolutionNote) {
      return { ok: false as const, reason: "resolution_note_required" };
    }
    if (
      readString(previousMetadata.last_action_idempotency_key) === actionIdempotencyKey
      && currentStatus === "resolved"
    ) {
      return {
        ok: true as const,
        action,
        incidentId: input.incidentId,
        status: "resolved",
        resumedScheduling: input.resumeScheduling === true,
        idempotent: true,
      };
    }
    const resumeScheduling = input.resumeScheduling === true;
    const { data: updated, error } = await supabase
      .from("account_incidents")
      .update({
        status: "resolved",
        resolved_at: now,
        resolved_by: input.actorId ?? null,
        acknowledged_at: readString(row.acknowledged_at) || now,
        updated_at: now,
        metadata: {
          ...previousMetadata,
          last_human_action: resumeScheduling ? "resolve_and_resume_scheduling" : "resolve",
          last_human_action_at: now,
          last_human_actor_type: input.actorType,
          last_action_idempotency_key: actionIdempotencyKey,
          resolution_note: resolutionNote,
          resume_scheduling: resumeScheduling,
        },
      })
      .eq("id", input.incidentId)
      .in("status", ["open", "acknowledged"])
      .select("id,status,resolved_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) return { ok: false as const, reason: "incident_not_resolvable" };

    await supabase
      .from("account_dashboard_actions")
      .update({ status: "resolved", resolved_at: now, updated_at: now })
      .eq("incident_id", input.incidentId)
      .in("status", ["pending", "acknowledged", "pending_verification"]);

    await insertIncidentAudit({
      accountId,
      incidentId: input.incidentId,
      actionType: resumeScheduling ? "incident_resolved_resume_scheduling" : "incident_resolved",
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      source,
      status: "success",
      message: resumeScheduling ? "incident_resolved_resume_scheduling" : "incident_resolved",
      payload: { resolution_note: resolutionNote, resume_scheduling: resumeScheduling },
    });

    return {
      ok: true as const,
      action,
      incidentId: input.incidentId,
      status: "resolved",
      resumedScheduling: resumeScheduling,
    };
  }

  if (action === "keep_paused") {
    if (!accountId) return { ok: false as const, reason: "account_missing" };
    await cancelPendingAutoRestartRequests(accountId, "incident_keep_paused");
    const nextStatus = currentStatus === "open" ? "acknowledged" : currentStatus;
    await supabase
      .from("account_incidents")
      .update({
        status: nextStatus,
        acknowledged_at: readString(row.acknowledged_at) || now,
        acknowledged_by: input.actorId ?? null,
        updated_at: now,
        metadata: {
          ...previousMetadata,
          last_human_action: "keep_paused",
          last_human_action_at: now,
          operator_keep_paused: true,
          resolution_note: resolutionNote || previousMetadata.resolution_note || null,
        },
      })
      .eq("id", input.incidentId);
    await insertIncidentAudit({
      accountId,
      incidentId: input.incidentId,
      actionType: "incident_keep_paused",
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      source,
      status: "success",
      message: "incident_keep_paused",
      payload: { resolution_note: resolutionNote || null },
    });
    return { ok: true as const, action, incidentId: input.incidentId, status: nextStatus, resumedScheduling: false };
  }

  if (action === "manual_retry") {
    if (!accountId) return { ok: false as const, reason: "account_missing" };
    if (currentStatus !== "resolved") {
      return { ok: false as const, reason: "incident_manual_retry_requires_resolved" };
    }
    const idempotencyKey = readString(input.idempotencyKey).trim()
      || `incident-manual-retry:${input.incidentId}:${readString(input.requestedRunType, "account_session").trim().toLowerCase()}`;
    const priorIdempotency = readString(previousMetadata.last_action_idempotency_key);
    if (priorIdempotency && priorIdempotency === idempotencyKey) {
      return {
        ok: true as const,
        action,
        incidentId: input.incidentId,
        requestId: readString(previousMetadata.last_manual_retry_request_id) || null,
        requestedRunType: readString(input.requestedRunType, "account_session").trim().toLowerCase(),
        resumedScheduling: false,
        idempotent: true,
      };
    }
    const requestedRunType = readString(input.requestedRunType, "account_session").trim().toLowerCase();
    const eligibility = await evaluateRunStartEligibility(accountId, requestedRunType, { trigger: "manual", manualStart: true });
    if (!eligibility.ok) {
      return {
        ok: false as const,
        reason: eligibility.reason as RunStartBlockReason,
        eligibility,
      };
    }
    const { data: requestRow, error: requestError } = await supabase.rpc("create_account_run_request", {
      p_account_id: accountId,
      p_requested_by: input.actorId ?? null,
      p_actor_type: input.actorType === "botapp" ? "ops" : input.actorType,
      p_source_surface: source,
      p_requested_run_type: requestedRunType,
      p_idempotency_key: idempotencyKey,
      p_priority: 0,
      p_metadata_safe: redactIncidentEvidence({
        incident_id: input.incidentId,
        trigger: "incident_manual_retry",
        source,
        resolution_note: resolutionNote || null,
      }),
    });
    if (requestError) throw new Error(requestError.message);
    const requestId = readString((requestRow as SupabaseRecord | null)?.id);
    await supabase
      .from("account_incidents")
      .update({
        updated_at: now,
        metadata: {
          ...previousMetadata,
          last_action_idempotency_key: idempotencyKey,
          last_manual_retry_request_id: requestId || null,
          last_human_action: "manual_retry",
          last_human_action_at: now,
        },
      })
      .eq("id", input.incidentId);
    await insertManualRunAudit(
      accountId,
      "incident_manual_retry_requested",
      "success",
      "incident_manual_retry_requested",
      {
        incident_id: input.incidentId,
        request_id: requestId,
        requested_run_type: requestedRunType,
        source,
      },
    );
    await insertIncidentAudit({
      accountId,
      incidentId: input.incidentId,
      actionType: "incident_manual_retry_requested",
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      source,
      status: "success",
      message: "incident_manual_retry_requested",
      payload: { request_id: requestId, requested_run_type: requestedRunType },
    });
    return {
      ok: true as const,
      action,
      incidentId: input.incidentId,
      requestId,
      requestedRunType,
      resumedScheduling: false,
    };
  }

  return { ok: false as const, reason: "invalid_incident_action" };
}
