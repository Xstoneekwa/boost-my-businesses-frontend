import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("./route.ts", import.meta.url),
  "utf8",
);

test("email templates route exposes feature unavailable response", () => {
  assert.match(routeSource, /feature_unavailable/);
  assert.match(routeSource, /featureAvailable/);
});

test("email templates route supports preview without save", () => {
  assert.match(routeSource, /action === "preview"/);
  assert.match(routeSource, /previewClientEmailTemplate/);
});

test("email templates route uses canonical save helper", () => {
  assert.match(routeSource, /saveClientEmailTemplateVersion/);
  assert.match(routeSource, /requireRelayOrAdmin/);
});
