import { runReadinessNow, type ReadinessNowAudience } from "@/lib/instagram-dashboard/readiness-now";
import { confirmLoginAndRefreshReadiness } from "@/lib/instagram-dashboard/confirm-login-readiness";
import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  validateAccountId,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type ReadinessNowBody = {
  account_id?: unknown;
  audience?: unknown;
  dry_run?: unknown;
  operator_confirmation?: unknown;
  operator_id?: unknown;
  assignment_id?: unknown;
  expected_worker_sha?: unknown;
  cause_fixed_version?: unknown;
  idempotency_key?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readAudience(value: unknown): ReadinessNowAudience {
  return readString(value, "admin").toLowerCase() === "client" ? "client" : "admin";
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const, userId: null };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    const response = jsonError("Readiness relay authentication failed.", 403, { reason: relayAuth.reason });
    return { mode: "unauthorized" as const, response };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  const adminContext = await getInstagramAdminUserContext();
  return { mode: "admin_session" as const, userId: adminContext?.userId ?? null };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const body = await readJsonBody<ReadinessNowBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const operatorConfirmation = readBoolean(body?.operator_confirmation, false);
    const actorId = auth.userId;
    const { createSupabaseClient } = await import("@/lib/supabase");
    if (operatorConfirmation) {
      const operatorId = auth.mode === "admin_session"
        ? (actorId ?? "")
        : readString(body?.operator_id, "").trim();
      const expectedWorkerSha = readString(body?.expected_worker_sha, "").trim().toLowerCase();
      const causeFixedVersion = readString(body?.cause_fixed_version, "").trim();
      const idempotencyKey = readString(body?.idempotency_key, "").trim();
      const assignmentId = readString(body?.assignment_id, "").trim();
      if (!UUID.test(operatorId)) return jsonError("A valid operator identity is required.", 400, { reason: "operator_identity_required" });
      if (!/^[0-9a-f]{40}$/.test(expectedWorkerSha)) return jsonError("A certified Worker SHA is required.", 400, { reason: "expected_worker_sha_required" });
      if (!causeFixedVersion || causeFixedVersion.length > 160) return jsonError("A cause-fixed version is required.", 400, { reason: "cause_fixed_version_required" });
      if (!idempotencyKey || idempotencyKey.length > 120) return jsonError("A valid idempotency key is required.", 400, { reason: "idempotency_key_required" });
      if (assignmentId && !UUID.test(assignmentId)) return jsonError("Invalid assignment id.", 400, { reason: "assignment_id_invalid" });
      const result = await confirmLoginAndRefreshReadiness(createSupabaseClient(), {
        accountId,
        operatorId,
        assignmentId: assignmentId || null,
        expectedWorkerSha,
        causeFixedVersion,
        idempotencyKey,
      });
      return jsonOk(result);
    }
    const result = await runReadinessNow(createSupabaseClient(), {
      accountId,
      audience: readAudience(body?.audience),
      actorId,
      dryRun: readBoolean(body?.dry_run, true),
    });

    return jsonOk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run readiness check.";
    return jsonError(sanitizeRunControlReason(message, "Could not run readiness check."), 500);
  }
}
