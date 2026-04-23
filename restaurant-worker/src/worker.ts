import 'dotenv/config';
import { Job, QueueEvents, Worker } from "bullmq";

console.log("REDIS_URL:", process.env.REDIS_URL ? "OK" : "MISSING");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "OK" : "MISSING");

type RestaurantCallEventJobData = Record<string, unknown>;
type QueueCompletedEvent = {
  jobId: string;
  returnvalue: unknown;
};
type QueueFailedEvent = {
  jobId: string;
  failedReason: string;
};

const WORKER_CONCURRENCY = 5;

function log(label: string, details?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();

  if (details) {
    console.log(`[restaurant-worker] ${timestamp} ${label}`, details);
    return;
  }

  console.log(`[restaurant-worker] ${timestamp} ${label}`);
}

function logError(label: string, error: unknown, details?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();

  console.error(`[restaurant-worker] ${timestamp} ${label}`, {
    ...(details || {}),
    error: error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : String(error),
  });
}

async function main() {
  const queueModule = await import("./queue");
  const supabaseModule = await import("./supabase");

  const {
    defaultJobOptions,
    redisConnection,
    RESTAURANT_CALL_EVENTS_QUEUE,
  } = queueModule;
  const { supabase } = supabaseModule;

  async function processCallEvent(job: Job<RestaurantCallEventJobData>) {
    void supabase;

    log("processing job", {
      id: job.id,
      name: job.name,
      attemptsMade: job.attemptsMade,
      data: job.data,
    });

    return {
      receivedAt: new Date().toISOString(),
      acknowledged: true,
    };
  }

  const worker = new Worker<RestaurantCallEventJobData>(
    RESTAURANT_CALL_EVENTS_QUEUE,
    processCallEvent,
    {
      connection: redisConnection,
      concurrency: WORKER_CONCURRENCY,
    }
  );

  const queueEvents = new QueueEvents(RESTAURANT_CALL_EVENTS_QUEUE, {
    connection: redisConnection,
  });

  worker.on("ready", () => {
    log("worker ready", {
      queue: RESTAURANT_CALL_EVENTS_QUEUE,
      concurrency: WORKER_CONCURRENCY,
      retryConfig: defaultJobOptions,
    });
  });

  worker.on("active", (job: Job<RestaurantCallEventJobData>) => {
    log("job active", {
      id: job?.id,
      name: job?.name,
    });
  });

  worker.on("completed", (job: Job<RestaurantCallEventJobData>, result: unknown) => {
    log("job completed", {
      id: job.id,
      name: job.name,
      result,
    });
  });

  worker.on("failed", (job: Job<RestaurantCallEventJobData> | undefined, error: Error) => {
    logError("job failed", error, {
      id: job?.id ?? null,
      name: job?.name ?? null,
      attemptsMade: job?.attemptsMade ?? null,
    });
  });

  worker.on("error", (error: Error) => {
    logError("worker error", error);
  });

  queueEvents.on("completed", ({ jobId, returnvalue }: QueueCompletedEvent) => {
    log("queue event completed", {
      jobId,
      returnvalue,
    });
  });

  queueEvents.on("failed", ({ jobId, failedReason }: QueueFailedEvent) => {
    log("queue event failed", {
      jobId,
      failedReason,
    });
  });

  queueEvents.on("error", (error: Error) => {
    logError("queue events error", error);
  });

  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    log("shutdown started", { signal });

    try {
      await queueEvents.close();
      await worker.close();
      await redisConnection.quit();
      log("shutdown complete");
      process.exit(0);
    } catch (error) {
      logError("shutdown failed", error, { signal });
      process.exit(1);
    }
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  log("worker booting", {
    queue: RESTAURANT_CALL_EVENTS_QUEUE,
    retryConfig: defaultJobOptions,
  });
}

void main().catch((error: unknown) => {
  logError("worker bootstrap failed", error);
  process.exit(1);
});
