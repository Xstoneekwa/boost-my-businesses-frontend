import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const authSource = readFileSync(
  new URL("../../../../lib/instagram-dashboard/client-email-postmark-webhook-auth.ts", import.meta.url),
  "utf8",
);

test("postmark webhook route accepts POST only", () => {
  assert.match(routeSource, /export async function POST/);
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /405/);
});

test("postmark webhook route requires basic auth", () => {
  assert.match(routeSource, /verifyPostmarkWebhookBasicAuth/);
  assert.match(authSource, /timingSafeEqual/);
  assert.doesNotMatch(routeSource, /POSTMARK_WEBHOOK_PASSWORD/);
});

test("postmark webhook route ingests delivery events without exposing secrets", () => {
  assert.match(routeSource, /ingestPostmarkWebhookEvent/);
  assert.doesNotMatch(routeSource, /POSTMARK_SERVER_TOKEN/);
  assert.doesNotMatch(routeSource, /console\.log/);
});
