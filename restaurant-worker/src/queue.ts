import { JobsOptions, Queue } from "bullmq";
import IORedis from "ioredis";

export const RESTAURANT_CALL_EVENTS_QUEUE = "restaurant-call-events";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const redisUrl = requireEnv("REDIS_URL");

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: 5_000,
  },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export const restaurantCallEventsQueue = new Queue(RESTAURANT_CALL_EVENTS_QUEUE, {
  connection: redisConnection,
  defaultJobOptions,
});
