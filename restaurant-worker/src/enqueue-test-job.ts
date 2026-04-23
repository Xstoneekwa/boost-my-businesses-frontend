import "dotenv/config";
import { redisConnection, restaurantCallEventsQueue } from "./queue";

type TestCallEventJob = {
  event_type: "call_started";
  call_id: string;
  tenant_id: string;
  location_id: string;
  payload: {
    caller_phone: string;
    intent: string;
    question: string;
  };
};

const sampleJob: TestCallEventJob = {
  event_type: "call_started",
  call_id: "test_call_001",
  tenant_id: "0a549b8a-1a66-4337-b7e5-70f578810cb9",
  location_id: "e1ab7227-1255-4532-b002-c850186d68c4",
  payload: {
    caller_phone: "+27710000000",
    intent: "booking",
    question: "I want to book a table for 2 tonight at 7pm",
  },
};

async function main() {
  console.log("[restaurant-worker] enqueueing test job", sampleJob);

  const job = await restaurantCallEventsQueue.add("call_started", sampleJob);

  console.log("[restaurant-worker] test job enqueued", {
    jobId: job.id,
    queueName: restaurantCallEventsQueue.name,
  });
}

async function shutdown() {
  await restaurantCallEventsQueue.close();
  await redisConnection.quit();
}

main()
  .catch((error: unknown) => {
    console.error("[restaurant-worker] failed to enqueue test job", {
      error: error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : String(error),
    });
    process.exitCode = 1;
  })
  .finally(() => {
    void shutdown();
  });
