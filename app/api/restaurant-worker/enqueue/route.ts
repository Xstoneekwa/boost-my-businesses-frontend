import { Queue, type ConnectionOptions } from "bullmq";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUEUE_NAME = "restaurant-call-events";

type EnqueueRequestBody = {
  eventType?: unknown;
  callId?: unknown;
  tenantId?: unknown;
  locationId?: unknown;
  payload?: unknown;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }

  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0;

  if (!Number.isInteger(db) || db < 0) {
    throw new Error("REDIS_URL contains an invalid database index");
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: Request) {
  let queue: Queue | null = null;

  try {
    const providedSecret = request.headers.get("x-worker-enqueue-secret");
    const expectedSecret = process.env.WORKER_ENQUEUE_SECRET?.trim();

    console.log("EXPECTED SECRET:", expectedSecret ?? null);
    console.log("RECEIVED SECRET:", providedSecret ?? null);
    console.log("MATCH:", Boolean(expectedSecret && providedSecret === expectedSecret));

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as EnqueueRequestBody;
    const { eventType, callId, tenantId, locationId, payload } = body;

    if (
      !isNonEmptyString(eventType) ||
      !isNonEmptyString(callId) ||
      !isNonEmptyString(tenantId) ||
      !isNonEmptyString(locationId)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request body. eventType, callId, tenantId, and locationId are required.",
        },
        { status: 400 }
      );
    }

    const redisUrl = requireEnv("REDIS_URL");
    const connection = parseRedisConnection(redisUrl);

    queue = new Queue(QUEUE_NAME, { connection });

    await queue.add(eventType, {
      eventType,
      callId,
      tenantId,
      locationId,
      payload,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to enqueue worker job";

    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  } finally {
    if (queue) {
      await queue.close();
    }
  }
}
