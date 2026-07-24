import { createSupabaseClient } from "@/lib/supabase";
import { redactIncidentMetadata, type IncidentDbRow } from "./incident-operations";

type Row = Record<string, unknown>;

const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function objectValue(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function safeReference(metadata: Row, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(metadata[key]);
    if (value) return value.slice(0, 240);
  }
  return null;
}

function safeUuid(value: unknown): string | null {
  const normalized = text(value);
  return UUID.test(normalized) ? normalized : null;
}

function safeDeliveryError(status: string): string | null {
  return status === "failed" ? "Delivery failed; provider details remain server-side." : null;
}

function notificationRow(row: Row) {
  const status = text(row.status).toLowerCase() || "unknown";
  return {
    id: text(row.id),
    channel: text(row.channel).toLowerCase() || "unknown",
    status,
    attemptCount: Math.max(0, numberValue(row.attempt_count)),
    lastAttemptAt: nullableText(row.last_attempt_at),
    deliveredAt: nullableText(row.delivered_at),
    lastError: safeDeliveryError(status),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
  };
}

function actionRow(row: Row) {
  return {
    id: text(row.id),
    actionType: text(row.action_type) || "unknown_action",
    status: text(row.status) || "unknown",
    severity: text(row.severity) || "warning",
    title: nullableText(row.title),
    blockingCampaign: Boolean(row.blocking_campaign),
    requiresClientAction: Boolean(row.requires_client_action),
    acknowledgedAt: nullableText(row.acknowledged_at),
    resolvedAt: nullableText(row.resolved_at),
    createdAt: nullableText(row.created_at),
    updatedAt: nullableText(row.updated_at),
    metadataSafe: redactIncidentMetadata(row.metadata_safe ?? row.metadata),
  };
}

function reviewEventRow(row: Row) {
  return {
    id: text(row.id),
    eventType: text(row.event_type),
    previousStatus: nullableText(row.previous_status),
    newStatus: nullableText(row.new_status),
    resolutionReason: nullableText(row.resolution_reason),
    note: nullableText(row.note),
    actorType: text(row.actor_type) || "unknown",
    actorId: nullableText(row.actor_id),
    source: text(row.source) || "unknown",
    incidentVersion: numberValue(row.incident_version, 1),
    createdAt: nullableText(row.created_at),
    metadataSafe: redactIncidentMetadata(row.metadata_safe),
  };
}

function timeline(actions: ReturnType<typeof actionRow>[], reviewEvents: ReturnType<typeof reviewEventRow>[]) {
  return [
    ...actions.map((row) => ({
      id: `action:${row.id}`,
      actionType: row.actionType,
      message: `Dashboard action ${row.status}`,
      actorType: "system",
      actorId: null,
      createdAt: row.updatedAt ?? row.createdAt,
    })),
    ...reviewEvents.map((row) => ({
      id: `review:${row.id}`,
      actionType: row.eventType,
      message: row.resolutionReason ?? (row.note ? "Operator note recorded" : `Incident ${row.newStatus ?? row.eventType}`),
      actorType: row.actorType,
      actorId: row.actorId,
      createdAt: row.createdAt,
    })),
  ].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

export function buildIncidentDetail(input: {
  incident: IncidentDbRow;
  actions?: Row[];
  notifications?: Row[];
  reviewEvents?: Row[];
  run?: Row | null;
  request?: Row | null;
  assignment?: Row | null;
  device?: Row | null;
  clone?: Row | null;
  appInstance?: Row | null;
  runtimeEvent?: Row | null;
}) {
  const incident = input.incident;
  const rawMetadata = objectValue(incident.metadata);
  const runSummary = objectValue(input.run?.performance_summary);
  const metadataSafe = {
    ...redactIncidentMetadata(rawMetadata),
    ...redactIncidentMetadata(input.runtimeEvent?.metadata),
  };
  const recovery = objectValue(rawMetadata.recovery);
  const actions = (input.actions ?? []).map(actionRow);
  const reviewEvents = (input.reviewEvents ?? []).map(reviewEventRow);
  const notifications = (input.notifications ?? []).map(notificationRow);
  const latestAction = actions[0] ?? null;
  const activeOperatorAction = actions.find((row) => row.actionType === "operator_review_required" && ACTIVE_ACTION_STATUSES.has(row.status)) ?? null;
  const requestId = safeUuid(input.request?.id)
    ?? safeUuid(safeReference(rawMetadata, ["request_id", "run_request_id"]));
  const appInstanceId = safeUuid(input.appInstance?.id)
    ?? safeUuid(input.assignment?.app_instance_id)
    ?? safeUuid(safeReference(rawMetadata, ["app_instance_id"]));
  const workerRelease = safeReference(rawMetadata, ["worker_release", "release", "runtime_release"])
    ?? safeReference(runSummary, ["worker_release", "release", "runtime_release"]);
  const workerCommit = safeReference(rawMetadata, ["worker_commit", "commit", "worker_sha"])
    ?? safeReference(runSummary, ["worker_commit", "commit", "worker_sha"]);
  const reason = text(incident.reason) || text(incident.failure_reason) || text(incident.incident_type) || "unknown_incident";
  const status = text(incident.status).toLowerCase() || "open";
  const summary = nullableText(incident.admin_message)
    ?? nullableText(incident.assistant_message)
    ?? nullableText(incident.safe_client_message)
    ?? nullableText(incident.action_required)
    ?? "No additional summary was recorded.";
  const byChannel = (channel: "slack" | "discord") => {
    const history = notifications.filter((row) => row.channel === channel);
    return { channel, current: history[0] ?? null, history };
  };

  return {
    contractVersion: "incident_detail_v1",
    incident: {
      id: text(incident.id),
      accountId: nullableText(incident.account_id),
      clientId: nullableText(incident.client_id),
      tenantId: safeUuid(rawMetadata.tenant_id),
      accountUsername: nullableText(incident.account_username),
      accountDisplay: nullableText(incident.account_username),
      severity: text(incident.severity) || "warning",
      status,
      displayState: status === "resolved" || status === "ignored"
        ? status
        : activeOperatorAction ? "action_required" : status,
      incidentType: text(incident.incident_type) || "unknown_incident",
      title: safeReference(rawMetadata, ["operator_label", "title"]) ?? (text(incident.incident_type) || "Incident"),
      reason,
      reasonCode: reason,
      failureReason: nullableText(incident.failure_reason),
      structuredFailureReason: safeReference(rawMetadata, ["structured_failure_reason", "reason_code"]),
      summary,
      actionRequired: nullableText(incident.action_required),
      blockingCampaign: Boolean(activeOperatorAction?.blockingCampaign),
      operatorReviewRequired: Boolean(activeOperatorAction),
      operatorReviewStatus: activeOperatorAction ? "pending" : actions.some((row) => row.actionType === "operator_review_required" && row.status === "resolved") ? "reviewed" : "none",
      occurrenceCount: Math.max(1, numberValue(incident.occurrence_count, 1)),
      firstSeenAt: nullableText(incident.first_seen_at),
      lastSeenAt: nullableText(incident.last_seen_at),
      createdAt: nullableText(incident.created_at),
      updatedAt: nullableText(incident.updated_at),
      acknowledgedAt: nullableText(incident.acknowledged_at),
      acknowledgedBy: nullableText(incident.acknowledged_by),
      resolvedAt: nullableText(incident.resolved_at),
      resolvedBy: nullableText(incident.resolved_by),
      resolutionReason: nullableText(incident.resolution_reason),
      resolutionNote: nullableText(incident.resolution_note),
      version: Math.max(1, numberValue(incident.lifecycle_version, 1)),
      source: nullableText(incident.source),
      sourceEventId: nullableText(incident.source_event_id),
      runId: nullableText(incident.run_id),
      requestId,
      assignmentId: nullableText(incident.assignment_id) ?? nullableText(input.assignment?.id),
      deviceId: nullableText(incident.device_id) ?? nullableText(input.assignment?.device_id),
      cloneId: nullableText(incident.clone_id) ?? nullableText(input.assignment?.clone_id),
      appInstanceId,
      workerRelease,
      workerCommit,
      metadataSafe,
    },
    linked: {
      run: input.run ? {
        id: nullableText(input.run.id),
        status: nullableText(input.run.status),
        startedAt: nullableText(input.run.started_at),
        finishedAt: nullableText(input.run.finished_at ?? input.run.completed_at),
        workerType: nullableText(input.run.worker_type),
        errorCode: safeReference(runSummary, ["error_code", "reason_code"]),
      } : null,
      request: input.request ? {
        id: nullableText(input.request.id),
        status: nullableText(input.request.status),
        runType: nullableText(input.request.requested_run_type),
        sourceSurface: nullableText(input.request.source_surface),
        errorCode: nullableText(input.request.error_code),
        errorMessageSafe: nullableText(input.request.error_message_safe),
        createdAt: nullableText(input.request.created_at),
        completedAt: nullableText(input.request.completed_at),
      } : null,
      assignment: input.assignment ? {
        id: nullableText(input.assignment.id),
        status: nullableText(input.assignment.status),
        assignmentType: nullableText(input.assignment.assignment_type),
        appInstanceId,
      } : null,
      device: input.device ? {
        id: nullableText(input.device.id),
        label: nullableText(input.device.name ?? input.device.device_name),
        hostMachine: nullableText(input.device.host_machine),
        status: nullableText(input.device.status),
      } : null,
      clone: input.clone ? {
        id: nullableText(input.clone.id),
        index: numberValue(input.clone.clone_index),
        label: nullableText(input.clone.clone_label),
        status: nullableText(input.clone.status),
      } : null,
      appInstance: input.appInstance ? {
        id: nullableText(input.appInstance.id),
        type: nullableText(input.appInstance.instance_type),
        index: numberValue(input.appInstance.instance_index),
        label: nullableText(input.appInstance.visible_label),
        packageName: nullableText(input.appInstance.package_name),
        status: nullableText(input.appInstance.status),
      } : null,
      runtimeEvent: input.runtimeEvent ? {
        id: nullableText(input.runtimeEvent.id),
        type: nullableText(input.runtimeEvent.event_type),
        severity: nullableText(input.runtimeEvent.severity),
        source: nullableText(input.runtimeEvent.source),
        reason: nullableText(input.runtimeEvent.reason),
        createdAt: nullableText(input.runtimeEvent.created_at),
      } : null,
    },
    latestAction,
    operatorReviewAction: activeOperatorAction ? {
      id: activeOperatorAction.id,
      accountId: text(incident.account_id),
      status: activeOperatorAction.status,
      blockingCampaign: activeOperatorAction.blockingCampaign,
    } : null,
    actionHistory: actions,
    reviewHistory: reviewEvents,
    timeline: timeline(actions, reviewEvents),
    notifications,
    notificationChannels: {
      slack: byChannel("slack"),
      discord: byChannel("discord"),
    },
    lifecycle: {
      acknowledgeSupported: status === "open",
      investigatingStateSupported: false,
      resolveSupported: status === "open" || status === "acknowledged",
      reopenSupported: false,
      addNoteSupported: true,
      retryFailedNotificationSupported: true,
    },
    retention: {
      archivedAt: nullableText(incident.archived_at),
      legalHold: Boolean(incident.legal_hold),
      retentionClass: nullableText(incident.retention_class),
      policyVersion: nullableText(incident.retention_policy_version),
      purgeAfter: nullableText(incident.purge_after),
    },
    recovery: Object.keys(recovery).length ? {
      state: nullableText(recovery.state),
      eligible: Boolean(recovery.eligible),
      reason: nullableText(recovery.reason),
      windowStart: nullableText(recovery.window_start ?? recovery.windowStart),
      windowEnd: nullableText(recovery.window_end ?? recovery.windowEnd),
      windowActive: Boolean(recovery.window_active ?? recovery.windowActive),
      authorizationId: safeUuid(recovery.authorization_id ?? recovery.authorizationId),
      authorizationStatus: nullableText(recovery.authorization_status ?? recovery.authorizationStatus),
    } : null,
  };
}

export async function loadIncidentDetail(incidentId: string) {
  const supabase = createSupabaseClient();
  const { data: incident, error: incidentError } = await supabase
    .from("account_incidents")
    .select("id,created_at,updated_at,first_seen_at,last_seen_at,resolved_at,status,severity,incident_type,occurrence_count,client_id,account_id,account_username,run_id,assignment_id,device_id,clone_id,source_event_id,source,reason,failure_reason,action_required,safe_client_message,assistant_message,admin_message,metadata,acknowledged_at,acknowledged_by,resolved_by,archived_at,legal_hold,retention_class,retention_policy_version,purge_after,lifecycle_version,resolution_reason,resolution_note")
    .eq("id", incidentId)
    .maybeSingle<Row>();
  if (incidentError) throw new Error(`incident_detail_query_failed:${incidentError.code ?? "unknown"}`);
  if (!incident) return null;

  const [{ data: actions, error: actionsError }, { data: notifications, error: notificationsError }, { data: reviewEvents, error: reviewEventsError }] = await Promise.all([
    supabase.from("account_dashboard_actions").select("id,action_type,status,severity,title,blocking_campaign,requires_client_action,acknowledged_at,resolved_at,created_at,updated_at,metadata_safe,metadata").eq("incident_id", incidentId).order("created_at", { ascending: false }),
    supabase.from("account_incident_notifications").select("id,channel,status,attempt_count,last_attempt_at,delivered_at,created_at,updated_at").eq("incident_id", incidentId).order("created_at", { ascending: false }),
    supabase.from("account_incident_review_events").select("id,event_type,previous_status,new_status,resolution_reason,note,actor_type,actor_id,source,incident_version,metadata_safe,created_at").eq("incident_id", incidentId).order("created_at", { ascending: false }),
  ]);
  if (actionsError || notificationsError || reviewEventsError) {
    throw new Error(`incident_detail_related_query_failed:${actionsError?.code ?? notificationsError?.code ?? reviewEventsError?.code ?? "unknown"}`);
  }

  const rawMetadata = objectValue(incident.metadata);
  const runId = safeUuid(incident.run_id);
  const requestId = safeUuid(safeReference(rawMetadata, ["request_id", "run_request_id"]));
  const assignmentId = safeUuid(incident.assignment_id);
  const deviceId = safeUuid(incident.device_id);
  const cloneId = safeUuid(incident.clone_id);
  const sourceEventId = safeUuid(incident.source_event_id);

  const [runResult, requestResult, assignmentResult, deviceResult, cloneResult, runtimeEventResult] = await Promise.all([
    runId ? supabase.from("ig_runs").select("id,status,started_at,finished_at,completed_at,worker_type,performance_summary").eq("id", runId).maybeSingle<Row>() : Promise.resolve({ data: null, error: null }),
    requestId
      ? supabase.from("account_run_requests").select("id,status,requested_run_type,source_surface,error_code,error_message_safe,created_at,completed_at,run_id,metadata_safe").eq("id", requestId).maybeSingle<Row>()
      : runId
        ? supabase.from("account_run_requests").select("id,status,requested_run_type,source_surface,error_code,error_message_safe,created_at,completed_at,run_id,metadata_safe").eq("run_id", runId).order("created_at", { ascending: false }).limit(1).maybeSingle<Row>()
        : Promise.resolve({ data: null, error: null }),
    assignmentId
      ? supabase.from("account_assignments").select("id,status,assignment_type,device_id,clone_id,app_instance_id").eq("id", assignmentId).maybeSingle<Row>()
      : safeUuid(incident.account_id)
        ? supabase.from("account_assignments").select("id,status,assignment_type,device_id,clone_id,app_instance_id").eq("account_id", text(incident.account_id)).in("status", ["reserved", "active"]).order("updated_at", { ascending: false }).limit(1).maybeSingle<Row>()
        : Promise.resolve({ data: null, error: null }),
    deviceId ? supabase.from("phone_devices").select("id,name,device_name,host_machine,status").eq("id", deviceId).maybeSingle<Row>() : Promise.resolve({ data: null, error: null }),
    cloneId ? supabase.from("phone_clones").select("id,clone_index,clone_label,status").eq("id", cloneId).maybeSingle<Row>() : Promise.resolve({ data: null, error: null }),
    sourceEventId ? supabase.from("runtime_events").select("id,created_at,event_type,severity,source,reason,metadata").eq("id", sourceEventId).maybeSingle<Row>() : Promise.resolve({ data: null, error: null }),
  ]);
  const referenceError = runResult.error ?? requestResult.error ?? assignmentResult.error ?? deviceResult.error ?? cloneResult.error ?? runtimeEventResult.error;
  if (referenceError) throw new Error(`incident_detail_reference_query_failed:${referenceError.code ?? "unknown"}`);

  const resolvedDeviceId = safeUuid(deviceId ?? assignmentResult.data?.device_id);
  const resolvedCloneId = safeUuid(cloneId ?? assignmentResult.data?.clone_id);
  const appInstanceId = safeUuid(assignmentResult.data?.app_instance_id) ?? safeUuid(safeReference(rawMetadata, ["app_instance_id"]));
  const [resolvedDeviceResult, resolvedCloneResult, appInstanceResult] = await Promise.all([
    !deviceResult.data && resolvedDeviceId ? supabase.from("phone_devices").select("id,name,device_name,host_machine,status").eq("id", resolvedDeviceId).maybeSingle<Row>() : Promise.resolve(deviceResult),
    !cloneResult.data && resolvedCloneId ? supabase.from("phone_clones").select("id,clone_index,clone_label,status").eq("id", resolvedCloneId).maybeSingle<Row>() : Promise.resolve(cloneResult),
    appInstanceId ? supabase.from("phone_app_instances").select("id,instance_type,instance_index,visible_label,package_name,status").eq("id", appInstanceId).maybeSingle<Row>() : Promise.resolve({ data: null, error: null }),
  ]);
  const resolvedReferenceError = resolvedDeviceResult.error ?? resolvedCloneResult.error ?? appInstanceResult.error;
  if (resolvedReferenceError) throw new Error(`incident_detail_binding_query_failed:${resolvedReferenceError.code ?? "unknown"}`);

  return buildIncidentDetail({
    incident,
    actions: actions ?? [],
    notifications: notifications ?? [],
    reviewEvents: reviewEvents ?? [],
    run: runResult.data,
    request: requestResult.data,
    assignment: assignmentResult.data,
    device: resolvedDeviceResult.data,
    clone: resolvedCloneResult.data,
    appInstance: appInstanceResult.data,
    runtimeEvent: runtimeEventResult.data,
  });
}
