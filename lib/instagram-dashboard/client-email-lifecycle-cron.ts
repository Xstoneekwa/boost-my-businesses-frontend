import { timingSafeEqual } from "node:crypto";
import { resolveClientCommunicationEmail } from "./client-communication-email.ts";
import { resolveTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import { evaluateClientEmailMaterializationExecutionGate } from "./client-email-materialization-execution-gate.ts";
import { executeSingleClientEmailMaterializationInternal } from "./client-email-materialization-executor.ts";
import {
  buildClientEmailLifecycleOutboxPlan,
} from "./client-email-lifecycle-outbox-plan.ts";
import { shouldIncludeOutboxPreviewRow } from "./client-email-lifecycle-outbox-preview.ts";
import { enrichEffectiveCandidateWithGateProjections } from "./client-email-lifecycle-outbox-gates.ts";
import { selectEffectiveOutboxCandidates } from "./client-email-lifecycle-outbox-precedence.ts";
import { isIntentMaterializeOperation } from "./client-email-outbox-materializer.ts";
import { runNeedsMoreDispatchBatch } from "./client-email-outbox-dispatch.ts";
import {
  evaluateNeedsMoreMaterializePersistGate,
  evaluateNeedsMoreDispatchAutomationGate,
} from "./client-email-needs-more-targets-automation-config.ts";
import {
  loadAllNeedsMoreTargetsReconcileSnapshots,
  reconcileNeedsMoreTargetAccountEmailSequences,
} from "./client-email-needs-more-targets-reconcile.ts";
import {
  buildClientEmailLifecycleCronHeartbeatMetadata,
  type ClientEmailLifecycleCronInvoker,
  type ClientEmailLifecycleSchedulerStatus,
  projectClientEmailLifecycleSchedulerHealth,
} from "./client-email-lifecycle-scheduler-health.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

export const CLIENT_EMAIL_LIFECYCLE_CRON_WORKER_ID = "client_email_lifecycle_cron" as const;
const CRON_SECRET_HEADER = "authorization";

export type ClientEmailLifecycleCronAuthReason =
  | "cron_secret_not_configured"
  | "missing_caller_secret"
  | "invalid_caller_secret";

export type ClientEmailLifecycleCronResult = {
  workerId: string;
  startedAt: string;
  finishedAt: string;
  invoker: ClientEmailLifecycleCronInvoker;
  schedulerStatus: ClientEmailLifecycleSchedulerStatus;
  skipped: boolean;
  skipReason: string | null;
  automationGateOpen: boolean;
  materializeGateOpen: boolean;
  dispatchGateOpen: boolean;
  reconcile: {
    accounts: number;
    episodesOpened: number;
    episodesClosed: number;
    persistedOpens: number;
    persistedCloses: number;
    intentsCanceled: number;
    persistAllowed: boolean;
  };
  materialize: {
    candidates: number;
    materialized: number;
    skipped: number;
    failed: number;
  };
  dispatch: {
    candidates: number;
    submitted: number;
    canceled: number;
    failed: number;
    uncertain: number;
    skipped: number;
  };
  incidentSignals: string[];
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export function extractClientEmailLifecycleCronSecret(request: Request) {
  const authorization = request.headers.get(CRON_SECRET_HEADER)?.trim() ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) return bearerMatch[1].trim();
  const cronHeader = request.headers.get("x-cron-secret")?.trim();
  return cronHeader ?? "";
}

export function tokensMatchConstantTime(expected: string, provided: string) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function evaluateClientEmailLifecycleCronAuth(
  env: Record<string, string | undefined>,
  callerSecret: string | null | undefined,
): { ok: true } | { ok: false; status: 401 | 403 | 503; reason: ClientEmailLifecycleCronAuthReason } {
  const configured = env.CRON_SECRET?.trim() ?? "";
  if (!configured) {
    return { ok: false, status: 503, reason: "cron_secret_not_configured" };
  }
  const provided = callerSecret?.trim() ?? "";
  if (!provided) {
    return { ok: false, status: 401, reason: "missing_caller_secret" };
  }
  if (!tokensMatchConstantTime(configured, provided)) {
    return { ok: false, status: 403, reason: "invalid_caller_secret" };
  }
  return { ok: true };
}

async function loadRecipientEmailForClient(
  supabase: ClientEmailSupabase,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("metadata,name")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const resolved = resolveClientCommunicationEmail({
    client: (data as Record<string, unknown> | null) ?? null,
    workspaceAuthEmail: null,
  });
  return resolved.ok ? resolved.email : null;
}

async function materializeNeedsMoreBatch(
  supabase: ClientEmailSupabase,
  input: {
    env: Record<string, string | undefined>;
    now: Date;
  },
) {
  const executionGate = evaluateClientEmailMaterializationExecutionGate(input.env);
  if (!executionGate.enabled) {
    return { candidates: 0, materialized: 0, skipped: 0, failed: 0 };
  }

  const [plan, deliverySettings] = await Promise.all([
    buildClientEmailLifecycleOutboxPlan(supabase, { now: input.now, env: input.env }),
    resolveTransactionalDeliverySettings(supabase),
  ]);

  const rawObservations = plan.rows.filter(shouldIncludeOutboxPreviewRow);
  const selection = selectEffectiveOutboxCandidates(rawObservations);
  const effectiveCandidates = selection.effectiveCandidates
    .filter((row) => row.category === "needs_more_target_accounts")
    .map((row) => enrichEffectiveCandidateWithGateProjections(row, plan, input.env))
    .filter((row) =>
      row.isEffectiveCandidate === true
      && row.materializationEligible === true
      && (row.decision === "would_create_initial_intent" || row.decision === "would_create_reminder_intent"),
    );

  let materialized = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of effectiveCandidates) {
    const recipientEmail = await loadRecipientEmailForClient(supabase, candidate.clientId);
    const template = candidate.activeTemplateId
      ? {
        id: candidate.activeTemplateId,
        category: candidate.category,
        version: candidate.activeTemplateVersion ?? 0,
        subject: candidate.futureIntentSnapshot?.snapshotSubject ?? "",
        bodyText: candidate.futureIntentSnapshot?.snapshotBodyText ?? "",
      }
      : undefined;

    const decision = await executeSingleClientEmailMaterializationInternal({
      supabase,
      candidate,
      recipientEmail,
      deliverySettings,
      template,
      env: input.env,
    });

    if (decision.status === "materialized" && isIntentMaterializeOperation(decision.operation)) {
      materialized += 1;
      continue;
    }
    if (decision.status === "materialize_failed") {
      failed += 1;
      continue;
    }
    skipped += 1;
  }

  return {
    candidates: effectiveCandidates.length,
    materialized,
    skipped,
    failed,
  };
}

async function readCronHeartbeatMetadata(supabase: ClientEmailSupabase) {
  const { data } = await supabase
    .from("worker_heartbeats")
    .select("metadata")
    .eq("worker_id", CLIENT_EMAIL_LIFECYCLE_CRON_WORKER_ID)
    .maybeSingle();
  return (data as { metadata?: Record<string, unknown> } | null)?.metadata ?? null;
}

async function recordCronHeartbeat(
  supabase: ClientEmailSupabase,
  input: {
    ok: boolean;
    invoker: ClientEmailLifecycleCronInvoker;
    consecutiveFailures: number;
    now: Date;
    incidentSignals: string[];
  },
) {
  const existingMetadata = await readCronHeartbeatMetadata(supabase);
  const metadata = buildClientEmailLifecycleCronHeartbeatMetadata({
    existingMetadata,
    ok: input.ok,
    invoker: input.invoker,
    now: input.now,
    consecutiveFailures: input.consecutiveFailures,
    incidentSignals: input.incidentSignals,
  });
  await supabase.from("worker_heartbeats").upsert({
    worker_id: CLIENT_EMAIL_LIFECYCLE_CRON_WORKER_ID,
    status: input.ok ? "idle" : "degraded",
    last_seen_at: input.now.toISOString(),
    metadata,
  }, { onConflict: "worker_id" });
}

async function readConsecutiveCronFailures(supabase: ClientEmailSupabase) {
  const metadata = await readCronHeartbeatMetadata(supabase);
  const raw = metadata?.consecutive_failures;
  return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
}

function projectSchedulerStatusAfterTick(
  env: Record<string, string | undefined>,
  metadata: Record<string, unknown> | null,
  now: Date,
) {
  return projectClientEmailLifecycleSchedulerHealth({
    env,
    heartbeatMetadata: metadata,
    now,
  }).status;
}

export async function runClientEmailLifecycleCron(input: {
  supabase: ClientEmailSupabase;
  callerSecret?: string | null;
  invoker?: ClientEmailLifecycleCronInvoker;
  env?: Record<string, string | undefined>;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<
  | { status: 401 | 403 | 503; result: { reason: ClientEmailLifecycleCronAuthReason } }
  | { status: 200; result: ClientEmailLifecycleCronResult }
> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const startedAt = now.toISOString();
  const invoker = input.invoker ?? "manual";
  const auth = evaluateClientEmailLifecycleCronAuth(env, input.callerSecret);
  if (!auth.ok) {
    return { status: auth.status, result: { reason: auth.reason } };
  }

  const automationGate = evaluateNeedsMoreMaterializePersistGate(env);
  const materializeGate = evaluateClientEmailMaterializationExecutionGate(env);
  const dispatchGate = evaluateNeedsMoreDispatchAutomationGate(env);
  const incidentSignals: string[] = [];

  const emptyReconcile = {
    accounts: 0,
    episodesOpened: 0,
    episodesClosed: 0,
    persistedOpens: 0,
    persistedCloses: 0,
    intentsCanceled: 0,
    persistAllowed: false,
  };

  if (!automationGate.allowed) {
    await recordCronHeartbeat(input.supabase, {
      ok: true,
      invoker,
      consecutiveFailures: 0,
      now,
      incidentSignals,
    });
    const heartbeatMetadata = await readCronHeartbeatMetadata(input.supabase);
    const finishedAt = new Date().toISOString();
    const schedulerStatus = projectSchedulerStatusAfterTick(env, heartbeatMetadata, now);
    return {
      status: 200,
      result: {
        workerId: CLIENT_EMAIL_LIFECYCLE_CRON_WORKER_ID,
        startedAt,
        finishedAt,
        invoker,
        schedulerStatus,
        skipped: true,
        skipReason: automationGate.reason,
        automationGateOpen: false,
        materializeGateOpen: materializeGate.enabled,
        dispatchGateOpen: dispatchGate.allowed,
        reconcile: emptyReconcile,
        materialize: { candidates: 0, materialized: 0, skipped: 0, failed: 0 },
        dispatch: {
          candidates: 0,
          submitted: 0,
          canceled: 0,
          failed: 0,
          uncertain: 0,
          skipped: 0,
        },
        incidentSignals,
      },
    };
  }

  let tickOk = true;
  try {
    const snapshots = await loadAllNeedsMoreTargetsReconcileSnapshots(input.supabase);
    const reconcile = await reconcileNeedsMoreTargetAccountEmailSequences(input.supabase, {
      snapshots,
      now,
      env,
    });

    const materialize = materializeGate.enabled
      ? await materializeNeedsMoreBatch(input.supabase, { env, now })
      : { candidates: 0, materialized: 0, skipped: 0, failed: 0 };

    const dispatch = await runNeedsMoreDispatchBatch(input.supabase, {
      env,
      now,
      fetcher: input.fetcher,
    });

    if (dispatch.uncertain > 0) {
      incidentSignals.push("dispatch_uncertain_present");
    }
    if (materialize.failed > 0) {
      incidentSignals.push("materialize_failures_present");
    }

    const previousFailures = await readConsecutiveCronFailures(input.supabase);
    await recordCronHeartbeat(input.supabase, {
      ok: true,
      invoker,
      consecutiveFailures: 0,
      now: new Date(),
      incidentSignals,
    });
    const heartbeatMetadata = await readCronHeartbeatMetadata(input.supabase);
    const schedulerStatus = projectSchedulerStatusAfterTick(env, heartbeatMetadata, new Date());

    void previousFailures;
    const finishedAt = new Date().toISOString();
    return {
      status: 200,
      result: {
        workerId: CLIENT_EMAIL_LIFECYCLE_CRON_WORKER_ID,
        startedAt,
        finishedAt,
        invoker,
        schedulerStatus,
        skipped: false,
        skipReason: null,
        automationGateOpen: true,
        materializeGateOpen: materializeGate.enabled,
        dispatchGateOpen: dispatch.dispatchGateOpen,
        reconcile: {
          accounts: snapshots.length,
          episodesOpened: reconcile.episodesOpened,
          episodesClosed: reconcile.episodesClosed,
          persistedOpens: reconcile.persistedOpens,
          persistedCloses: reconcile.persistedCloses,
          intentsCanceled: reconcile.intentsCanceled,
          persistAllowed: reconcile.persistAllowed,
        },
        materialize,
        dispatch: {
          candidates: dispatch.candidates,
          submitted: dispatch.submitted,
          canceled: dispatch.canceled,
          failed: dispatch.failed,
          uncertain: dispatch.uncertain,
          skipped: dispatch.skipped,
        },
        incidentSignals,
      },
    };
  } catch (error) {
    tickOk = false;
    const previousFailures = await readConsecutiveCronFailures(input.supabase);
    const consecutiveFailures = previousFailures + 1;
    if (consecutiveFailures >= 3) {
      incidentSignals.push("cron_consecutive_failures");
    }
    await recordCronHeartbeat(input.supabase, {
      ok: false,
      invoker,
      consecutiveFailures,
      now: new Date(),
      incidentSignals,
    });
    throw error;
  } finally {
    void tickOk;
  }
}
