import { jsonError, jsonOk, readJsonBody, readInteger, readString } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { targetAvailabilityPrivateRequestAuthorized } from "@/lib/target-availability/private-auth";
import { processTargetAvailabilityBatch } from "@/lib/target-availability/runtime-pipeline";

export const dynamic = "force-dynamic";

type IngestBody = Readonly<{
  rows?: unknown;
  worker_id?: unknown;
  worker_release?: unknown;
  batch_key?: unknown;
  queue_depth?: unknown;
}>;

export async function POST(request: Request) {
  if (!targetAvailabilityPrivateRequestAuthorized(request)) {
    return jsonError("Target Availability authentication failed.", 401, { reason: "invalid_caller_token" });
  }

  const body = await readJsonBody<IngestBody>(request);
  const workerId = readString(request.headers.get("x-run-control-worker-id"), "").trim()
    || readString(body?.worker_id, "").trim();
  const workerRelease = readString(body?.worker_release, "").trim();
  const batchKey = readString(body?.batch_key, "").trim();
  if (!body || !Array.isArray(body.rows)) {
    return jsonError("Target Availability rows are required.", 400, { reason: "invalid_rows" });
  }
  if (!workerId || workerId.length > 120 || !workerRelease || workerRelease.length > 120 || !batchKey || batchKey.length > 200) {
    return jsonError("Trusted Worker context is required.", 403, { reason: "invalid_worker_context" });
  }

  try {
    const result = await processTargetAvailabilityBatch(createSupabaseClient() as never, body.rows, {
      workerId,
      workerRelease,
      batchKey,
      queueDepth: Math.max(0, Math.min(2_000, readInteger(body.queue_depth, 0))),
    });
    return jsonOk({ log_event: "target_availability_pipeline_batch", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "target_availability_pipeline_failed";
    return jsonError("Target Availability pipeline failed.", 503, {
      reason: message.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 160),
    });
  }
}
