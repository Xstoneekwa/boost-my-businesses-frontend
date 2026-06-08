export type ReadinessNowAudience = "admin" | "client";

export type ReadinessNowClientStatus =
  | "connected_ready"
  | "checking_connection"
  | "action_required_2fa"
  | "action_required_checkpoint"
  | "update_password"
  | "capacity_unavailable"
  | "waiting_next_slot"
  | "try_again_later";

export type ReadinessNowAdminStatus =
  | "ready"
  | "needs_credentials"
  | "needs_login_verification"
  | "waiting_scheduled_assignment"
  | "capacity_unavailable"
  | "retry_later"
  | "checking_connection";

export type ReadinessNowResult = {
  audience: ReadinessNowAudience;
  readiness_status: ReadinessNowAdminStatus;
  client_status: ReadinessNowClientStatus;
  client_message: string;
  preflight_request_created: boolean;
  idempotent: boolean;
  next_action: string;
  reason: string;
  assignment_status?: "ready" | "missing" | "waiting_scheduled_assignment" | "blocked";
  phone_available?: boolean | null;
  app_instance_available?: boolean | null;
  request_id?: string | null;
  run_request_status?: string | null;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => PromiseLike<QueryResult>;
};

export type ReadinessNowSupabase = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

type Row = Record<string, unknown>;

const activeRequestStatuses = ["queued", "claimed", "starting", "running"];
const activeRunStatuses = ["queued", "pending", "starting", "running", "in_progress", "active"];
const connectedStatuses = new Set(["connected"]);
const readyProvisioningStatuses = new Set(["ready"]);
const activeCredentialStatuses = new Set(["active", "configured"]);
const twoFactorStatuses = new Set(["needs_2fa", "2fa_required"]);
const checkpointStatuses = new Set(["checkpoint"]);
const passwordStatuses = new Set(["password_invalid", "bad_password"]);

function query(supabase: ReadinessNowSupabase, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function firstRow(value: unknown) {
  return readRows(value)[0] ?? null;
}

function normalize(value: unknown) {
  return readString(value).toLowerCase();
}

function clientMessage(status: ReadinessNowClientStatus) {
  return {
    connected_ready: "Connecté",
    checking_connection: "Connexion en cours",
    action_required_2fa: "Code 2FA requis",
    action_required_checkpoint: "Checkpoint requis",
    update_password: "Mot de passe à mettre à jour",
    capacity_unavailable: "Aucun créneau disponible maintenant",
    waiting_next_slot: "En attente du prochain créneau",
    try_again_later: "Réessaie plus tard",
  }[status];
}

function safeResult(input: Omit<ReadinessNowResult, "client_message">): ReadinessNowResult {
  const result: ReadinessNowResult = {
    ...input,
    client_message: clientMessage(input.client_status),
  };
  if (input.audience === "client") {
    delete result.assignment_status;
    delete result.phone_available;
    delete result.app_instance_available;
    delete result.request_id;
    delete result.run_request_status;
  }
  return result;
}

function requestIdempotencyKey(assignmentId: string) {
  return `login-preflight-now:${assignmentId}`;
}

function deadlineForAssignment(assignment: Row, now: Date) {
  const startsAt = Date.parse(readString(assignment.starts_at));
  const endsAt = Date.parse(readString(assignment.ends_at));
  if (!Number.isFinite(endsAt)) return null;
  const safetyMs = 60_000;
  const expectedMs = 3 * 60_000;
  const latestFinish = Number.isFinite(startsAt) && startsAt > now.getTime()
    ? Math.min(startsAt - safetyMs, endsAt - safetyMs)
    : endsAt - safetyMs;
  if (now.getTime() + expectedMs >= latestFinish) return null;
  return new Date(latestFinish);
}

async function selectOne(supabase: ReadinessNowSupabase, table: string, accountId: string, columns: string) {
  const result = await query(supabase, table)
    .select(columns)
    .eq("account_id", accountId)
    .limit(1) as QueryResult;
  if (result.error) throw new Error(result.error.message || `${table}_unavailable`);
  return firstRow(result.data);
}

async function loadAccount(supabase: ReadinessNowSupabase, accountId: string) {
  const result = await query(supabase, "ig_accounts")
    .select("id,username,status,admin_lifecycle_status")
    .eq("id", accountId)
    .limit(1) as QueryResult;
  if (result.error) throw new Error(result.error.message || "account_unavailable");
  return firstRow(result.data);
}

async function loadAssignment(supabase: ReadinessNowSupabase, accountId: string) {
  const result = await query(supabase, "account_assignments")
    .select("id,account_id,device_id,app_instance_id,starts_at,ends_at,status")
    .eq("account_id", accountId)
    .in("status", ["reserved", "active"])
    .order("starts_at", { ascending: true })
    .limit(1) as QueryResult;
  if (result.error) throw new Error(result.error.message || "assignment_unavailable");
  return firstRow(result.data);
}

async function loadTargetAvailability(supabase: ReadinessNowSupabase, assignment: Row) {
  const deviceId = readString(assignment.device_id);
  const appInstanceId = readString(assignment.app_instance_id);
  if (!deviceId || !appInstanceId) return { phoneAvailable: false, appAvailable: false };
  const [phoneResult, appResult] = await Promise.all([
    query(supabase, "phone_devices").select("id,status").eq("id", deviceId).limit(1) as Promise<QueryResult>,
    query(supabase, "phone_app_instances")
      .select("id,device_id,status,current_account_id,usable_for_auto_login,is_launchable")
      .eq("id", appInstanceId)
      .limit(1) as Promise<QueryResult>,
  ]);
  if (phoneResult.error) throw new Error(phoneResult.error.message || "phone_unavailable");
  if (appResult.error) throw new Error(appResult.error.message || "app_instance_unavailable");
  const phone = firstRow(phoneResult.data);
  const app = firstRow(appResult.data);
  const phoneStatus = normalize(phone?.status);
  const appStatus = normalize(app?.status);
  return {
    phoneAvailable: Boolean(phone && ["available", "active", "online"].includes(phoneStatus)),
    appAvailable: Boolean(
      app
      && ["available", "occupied"].includes(appStatus)
      && app.usable_for_auto_login === true
      && app.is_launchable === true
    ),
  };
}

async function listActiveRequests(supabase: ReadinessNowSupabase, accountIds: string[]) {
  if (!accountIds.length) return [];
  const result = await query(supabase, "account_run_requests")
    .select("id,account_id,status,requested_run_type,idempotency_key")
    .in("account_id", accountIds)
    .in("status", activeRequestStatuses)
    .limit(accountIds.length * 5) as QueryResult;
  if (result.error) throw new Error(result.error.message || "active_requests_unavailable");
  return readRows(result.data);
}

async function listActiveRuns(supabase: ReadinessNowSupabase, accountIds: string[]) {
  if (!accountIds.length) return [];
  const result = await query(supabase, "ig_runs")
    .select("account_id,status")
    .in("account_id", accountIds)
    .in("status", activeRunStatuses)
    .limit(accountIds.length * 5) as QueryResult;
  if (result.error) throw new Error(result.error.message || "active_runs_unavailable");
  return readRows(result.data);
}

async function listPeerAccountIds(supabase: ReadinessNowSupabase, assignment: Row) {
  const deviceId = readString(assignment.device_id);
  const appInstanceId = readString(assignment.app_instance_id);
  const accountId = readString(assignment.account_id);
  if (!deviceId && !appInstanceId) return [];
  const result = await query(supabase, "account_assignments")
    .select("account_id,device_id,app_instance_id,status")
    .in("status", ["reserved", "active"])
    .limit(500) as QueryResult;
  if (result.error) throw new Error(result.error.message || "peer_assignments_unavailable");
  return [...new Set(readRows(result.data)
    .filter((row) => readString(row.account_id) !== accountId)
    .filter((row) => readString(row.device_id) === deviceId || readString(row.app_instance_id) === appInstanceId)
    .map((row) => readString(row.account_id))
    .filter(Boolean))];
}

async function hasAvailableSlot(supabase: ReadinessNowSupabase, accountId: string) {
  const { data, error } = await supabase.rpc("list_available_assignment_slots", { p_account_id: accountId });
  if (error) return false;
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data as Row : {};
  const slots = Array.isArray(payload.slots) ? payload.slots as Row[] : [];
  return slots.some((slot) => slot.available === true);
}

function loginActionStatus(status: string): { admin: ReadinessNowAdminStatus; client: ReadinessNowClientStatus; reason: string; nextAction: string } | null {
  if (twoFactorStatuses.has(status)) {
    return { admin: "needs_login_verification", client: "action_required_2fa", reason: "login_status_needs_2fa", nextAction: "submit_2fa_code" };
  }
  if (checkpointStatuses.has(status)) {
    return { admin: "needs_login_verification", client: "action_required_checkpoint", reason: "login_status_checkpoint", nextAction: "complete_checkpoint" };
  }
  if (passwordStatuses.has(status)) {
    return { admin: "needs_credentials", client: "update_password", reason: "login_status_password_invalid", nextAction: "update_password" };
  }
  if (["login_failed", "failed", "mismatch", "logged_out"].includes(status)) {
    return { admin: "needs_login_verification", client: "try_again_later", reason: `login_status_${status}`, nextAction: "review_login_action" };
  }
  return null;
}

export async function runReadinessNow(
  supabase: ReadinessNowSupabase,
  input: {
    accountId: string;
    audience?: ReadinessNowAudience;
    actorId?: string | null;
    now?: Date;
  },
): Promise<ReadinessNowResult> {
  const audience = input.audience ?? "admin";
  const now = input.now ?? new Date();
  const account = await loadAccount(supabase, input.accountId);
  if (!account) {
    return safeResult({
      audience,
      readiness_status: "retry_later",
      client_status: "try_again_later",
      assignment_status: "blocked",
      phone_available: null,
      app_instance_available: null,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: "review_account",
      reason: "account_not_found",
    });
  }

  const accountStatus = normalize(account.status);
  const lifecycleStatus = normalize(account.admin_lifecycle_status || account.status);
  if (["paused", "archived", "cancelled", "canceled", "trashed", "deleted"].includes(lifecycleStatus) || ["archived", "trashed", "deleted"].includes(accountStatus)) {
    return safeResult({
      audience,
      readiness_status: "retry_later",
      client_status: "try_again_later",
      assignment_status: "blocked",
      phone_available: null,
      app_instance_available: null,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: "review_account",
      reason: "account_lifecycle_blocked",
    });
  }

  const [credential, clientStatus] = await Promise.all([
    selectOne(supabase, "account_credentials", input.accountId, "status,reauth_required"),
    selectOne(supabase, "client_instagram_accounts", input.accountId, "account_id,login_status,provisioning_status,onboarding_status"),
  ]);
  const credentialStatus = normalize(credential?.status);
  if (!credential || !activeCredentialStatuses.has(credentialStatus) || credential.reauth_required === true) {
    return safeResult({
      audience,
      readiness_status: "needs_credentials",
      client_status: "update_password",
      assignment_status: "missing",
      phone_available: null,
      app_instance_available: null,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: "submit_or_update_credentials",
      reason: credential?.reauth_required === true ? "credentials_reauth_required" : "credentials_missing_or_inactive",
    });
  }

  const loginStatus = normalize(clientStatus?.login_status || "unknown");
  const provisioningStatus = normalize(clientStatus?.provisioning_status || "unknown");
  if (connectedStatuses.has(loginStatus) && readyProvisioningStatuses.has(provisioningStatus)) {
    return safeResult({
      audience,
      readiness_status: "ready",
      client_status: "connected_ready",
      assignment_status: "ready",
      phone_available: null,
      app_instance_available: null,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: "none",
      reason: "already_connected_ready",
    });
  }

  const loginAction = loginActionStatus(loginStatus);
  if (loginAction) {
    return safeResult({
      audience,
      readiness_status: loginAction.admin,
      client_status: loginAction.client,
      assignment_status: "ready",
      phone_available: null,
      app_instance_available: null,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: loginAction.nextAction,
      reason: loginAction.reason,
    });
  }

  const assignment = await loadAssignment(supabase, input.accountId);
  if (!assignment || !readString(assignment.id) || !readString(assignment.device_id) || !readString(assignment.app_instance_id)) {
    const capacityAvailable = await hasAvailableSlot(supabase, input.accountId);
    return safeResult({
      audience,
      readiness_status: capacityAvailable ? "waiting_scheduled_assignment" : "capacity_unavailable",
      client_status: capacityAvailable ? "waiting_next_slot" : "capacity_unavailable",
      assignment_status: capacityAvailable ? "waiting_scheduled_assignment" : "missing",
      phone_available: false,
      app_instance_available: false,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: capacityAvailable ? "wait_for_scheduler_assignment" : "try_again_later",
      reason: capacityAvailable ? "waiting_scheduled_assignment" : "capacity_unavailable",
    });
  }

  const { phoneAvailable, appAvailable } = await loadTargetAvailability(supabase, assignment);
  if (!phoneAvailable || !appAvailable) {
    return safeResult({
      audience,
      readiness_status: "capacity_unavailable",
      client_status: "capacity_unavailable",
      assignment_status: "blocked",
      phone_available: phoneAvailable,
      app_instance_available: appAvailable,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: "try_again_later",
      reason: "phone_or_app_unavailable",
    });
  }

  const peerAccountIds = await listPeerAccountIds(supabase, assignment);
  const activeAccountIds = [input.accountId, ...peerAccountIds];
  const [activeRequests, activeRuns] = await Promise.all([
    listActiveRequests(supabase, activeAccountIds),
    listActiveRuns(supabase, activeAccountIds),
  ]);
  const assignmentId = readString(assignment.id);
  const idempotencyKey = requestIdempotencyKey(assignmentId);
  const duplicate = activeRequests.find((row) => readString(row.idempotency_key) === idempotencyKey);
  if (duplicate) {
    return safeResult({
      audience,
      readiness_status: "checking_connection",
      client_status: "checking_connection",
      assignment_status: "ready",
      phone_available: true,
      app_instance_available: true,
      preflight_request_created: false,
      idempotent: true,
      request_id: audience === "admin" ? readString(duplicate.id) || null : null,
      run_request_status: readString(duplicate.status, "queued"),
      next_action: "monitor_preflight",
      reason: "already_requested",
    });
  }
  const activeForAccount = activeRequests.some((row) => readString(row.account_id) === input.accountId) || activeRuns.some((row) => readString(row.account_id) === input.accountId);
  const activeForPeer = activeRequests.some((row) => peerAccountIds.includes(readString(row.account_id))) || activeRuns.some((row) => peerAccountIds.includes(readString(row.account_id)));
  if (activeForAccount || activeForPeer) {
    return safeResult({
      audience,
      readiness_status: "retry_later",
      client_status: "try_again_later",
      assignment_status: "ready",
      phone_available: true,
      app_instance_available: true,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: "try_again_later",
      reason: activeForPeer ? "skipped_phone_busy" : "account_busy",
    });
  }

  const deadline = deadlineForAssignment(assignment, now);
  if (!deadline) {
    return safeResult({
      audience,
      readiness_status: "retry_later",
      client_status: "try_again_later",
      assignment_status: "ready",
      phone_available: true,
      app_instance_available: true,
      preflight_request_created: false,
      idempotent: false,
      request_id: null,
      run_request_status: null,
      next_action: "try_again_later",
      reason: "deadline_too_close",
    });
  }

  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: input.accountId,
    p_requested_by: input.actorId ?? null,
    p_actor_type: audience === "admin" ? "admin" : "client",
    p_source_surface: audience === "admin" ? "instagram_dashboard_readiness_now" : "instagram_client_check_connect_now",
    p_requested_run_type: "login_provisioning",
    p_idempotency_key: idempotencyKey,
    p_priority: 0,
    p_metadata_safe: {
      source: "readiness_now",
      mode: "login_preflight_now",
      assignment_id: assignmentId,
      deadline_at: deadline.toISOString(),
    },
  });
  if (error) throw new Error(error.message || "readiness_now_enqueue_failed");
  const request = Array.isArray(data) ? data[0] as Row | undefined : data as Row | undefined;
  return safeResult({
    audience,
    readiness_status: "checking_connection",
    client_status: "checking_connection",
    assignment_status: "ready",
    phone_available: true,
    app_instance_available: true,
    preflight_request_created: true,
    idempotent: false,
    request_id: audience === "admin" ? readString(request?.id) || null : null,
    run_request_status: readString(request?.status, "queued"),
    next_action: "monitor_preflight",
    reason: "login_preflight_now_queued",
  });
}
