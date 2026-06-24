import { randomUUID } from "node:crypto";
import {
  PreflightEnqueueError,
  type ReadinessNowSupabase,
} from "@/lib/instagram-dashboard/readiness-now";

type Row = Record<string, unknown>;

const ACTIVE_REQUEST_STATUSES = ["queued", "claimed", "starting", "running"] as const;
const LOGIN_PROVISIONING = "login_provisioning";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function firstRow(value: unknown) {
  return readRows(value)[0] ?? null;
}

export function clientConnectAttemptIdempotencyKey(assignmentId: string, attemptId: string) {
  return `login-preflight-now:${assignmentId}:${attemptId}`;
}

export type EnqueueClientConnectResult = {
  request: Row | null;
  preflight_request_created: boolean;
  idempotent: boolean;
  reason: string;
  run_request_status: string | null;
  request_id: string | null;
  blockers: string[];
};

async function listActiveLoginProvisioningRequests(supabase: ReadinessNowSupabase, accountId: string) {
  const result = await (supabase.from("account_run_requests") as {
    select: (...args: unknown[]) => {
      eq: (...args: unknown[]) => {
        eq: (...args: unknown[]) => {
          in: (...args: unknown[]) => {
            order: (...args: unknown[]) => {
              limit: (...args: unknown[]) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
            };
          };
        };
      };
    };
  })
    .select("id,account_id,status,requested_run_type,idempotency_key,run_id,created_at,updated_at")
    .eq("account_id", accountId)
    .eq("requested_run_type", LOGIN_PROVISIONING)
    .in("status", [...ACTIVE_REQUEST_STATUSES])
    .order("created_at", { ascending: false })
    .limit(5);
  if (result.error) throw new Error(result.error.message || "active_login_requests_unavailable");
  return readRows(result.data);
}

async function createLoginProvisioningRequest(
  supabase: ReadinessNowSupabase,
  args: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc("create_account_run_request", args);
  if (error) {
    const message = error.message || "client_connect_enqueue_failed";
    if (message.includes("account_run_already_requested")) {
      throw new PreflightEnqueueError("account_run_already_requested", message);
    }
    if (message.includes("invalid_actor_type")) {
      throw new PreflightEnqueueError("invalid_actor_type", message);
    }
    throw new PreflightEnqueueError("enqueue_rejected", message);
  }
  const request = Array.isArray(data) ? data[0] as Row | undefined : data as Row | undefined;
  if (!request) throw new PreflightEnqueueError("enqueue_rejected", "client_connect_enqueue_failed");
  return request;
}

function resultFromActiveRequest(request: Row, idempotent: boolean): EnqueueClientConnectResult {
  const status = readString(request.status, "queued");
  return {
    request,
    preflight_request_created: false,
    idempotent,
    reason: idempotent ? "already_requested" : "login_preflight_now_queued",
    run_request_status: status,
    request_id: readString(request.id) || null,
    blockers: [],
  };
}

export async function enqueueClientConnectRequest(
  supabase: ReadinessNowSupabase,
  input: {
    accountId: string;
    actorId?: string | null;
    assignmentId: string;
    deadlineAt: string;
  },
): Promise<EnqueueClientConnectResult> {
  const accountId = readString(input.accountId);
  const assignmentId = readString(input.assignmentId);
  if (!accountId || !assignmentId) {
    return {
      request: null,
      preflight_request_created: false,
      idempotent: false,
      reason: "login_preflight_request_not_active",
      run_request_status: null,
      request_id: null,
      blockers: ["enqueue_rejected"],
    };
  }

  const activeRequests = await listActiveLoginProvisioningRequests(supabase, accountId);
  const active = activeRequests[0] ?? null;
  if (active) {
    return resultFromActiveRequest(active, true);
  }

  const attemptId = randomUUID();
  const idempotencyKey = clientConnectAttemptIdempotencyKey(assignmentId, attemptId);
  const enqueueArgs = {
    p_account_id: accountId,
    p_requested_by: input.actorId ?? null,
    p_actor_type: "client",
    p_source_surface: "instagram_client_connect",
    p_requested_run_type: LOGIN_PROVISIONING,
    p_priority: 0,
    p_idempotency_key: idempotencyKey,
    p_metadata_safe: {
      source: "client_connect_enqueue",
      mode: "login_preflight_now",
      assignment_id: assignmentId,
      deadline_at: input.deadlineAt,
      connect_attempt_id: attemptId,
    },
  };

  try {
    const request = await createLoginProvisioningRequest(supabase, enqueueArgs);
    const status = readString(request.status, "queued");
    const requestActive = ACTIVE_REQUEST_STATUSES.includes(status as typeof ACTIVE_REQUEST_STATUSES[number]);
    if (!requestActive) {
      return {
        request: null,
        preflight_request_created: false,
        idempotent: false,
        reason: "login_preflight_request_not_active",
        run_request_status: status,
        request_id: readString(request.id) || null,
        blockers: ["login_preflight_request_not_active"],
      };
    }
    return {
      request,
      preflight_request_created: true,
      idempotent: false,
      reason: "login_preflight_now_queued",
      run_request_status: status,
      request_id: readString(request.id) || null,
      blockers: [],
    };
  } catch (error) {
    const code = error instanceof PreflightEnqueueError ? error.code : "enqueue_rejected";
    if (code === "account_run_already_requested") {
      const raced = (await listActiveLoginProvisioningRequests(supabase, accountId))[0] ?? null;
      if (raced) {
        return resultFromActiveRequest(raced, true);
      }
    }
    return {
      request: null,
      preflight_request_created: false,
      idempotent: false,
      reason: "login_preflight_request_not_active",
      run_request_status: null,
      request_id: null,
      blockers: ["enqueue_rejected"],
    };
  }
}

export async function loadClientConnectAssignment(
  supabase: ReadinessNowSupabase,
  accountId: string,
) {
  const result = await (supabase.from("account_assignments") as {
    select: (...args: unknown[]) => {
      eq: (...args: unknown[]) => {
        in: (...args: unknown[]) => {
          order: (...args: unknown[]) => {
            limit: (...args: unknown[]) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
          };
        };
      };
    };
  })
    .select("id,account_id,device_id,app_instance_id,starts_at,ends_at,status")
    .eq("account_id", accountId)
    .in("status", ["reserved", "active"])
    .order("starts_at", { ascending: true })
    .limit(1);
  if (result.error) throw new Error(result.error.message || "assignment_unavailable");
  return firstRow(result.data);
}

export function deadlineForClientConnectAssignment(assignment: Row, now = new Date()) {
  const startsAt = Date.parse(readString(assignment.starts_at));
  const endsAt = Date.parse(readString(assignment.ends_at));
  if (!Number.isFinite(endsAt)) return new Date(now.getTime() + 10 * 60_000);
  const safetyMs = 60_000;
  const expectedMs = 3 * 60_000;
  const latestFinish = Number.isFinite(startsAt) && startsAt > now.getTime()
    ? Math.min(startsAt - safetyMs, endsAt - safetyMs)
    : endsAt - safetyMs;
  if (now.getTime() + expectedMs >= latestFinish) return new Date(latestFinish);
  return new Date(latestFinish);
}
