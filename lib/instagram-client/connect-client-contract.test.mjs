import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clientConnectMessage,
  mapReadinessToClientConnectStatus,
  mapRpcErrorToConnectStatus,
} from "./connect-client-contract.ts";

test("mapRpcErrorToConnectStatus maps invalid_actor_type to not_created", () => {
  const mapped = mapRpcErrorToConnectStatus("invalid_actor_type");
  assert.equal(mapped.status, "not_created");
  assert.equal(mapped.code, "connect_request_rejected");
});

test("mapRpcErrorToConnectStatus maps account_run_already_requested to already_queued", () => {
  const mapped = mapRpcErrorToConnectStatus("account_run_already_requested");
  assert.equal(mapped.status, "already_queued");
});

test("mapReadinessToClientConnectStatus returns queued on first enqueue", () => {
  const status = mapReadinessToClientConnectStatus({
    readiness: {
      audience: "client",
      readiness_status: "checking_connection",
      client_status: "checking_connection",
      client_message: "",
      assignment_status: "ready",
      phone_available: true,
      app_instance_available: true,
      preflight_request_created: true,
      idempotent: false,
      request_id: null,
      run_request_status: "queued",
      next_action: "monitor_preflight",
      reason: "login_preflight_now_queued",
      blockers: [],
      checks: {},
    },
  });
  assert.equal(status, "queued");
});

test("mapReadinessToClientConnectStatus returns already_queued for idempotent duplicate", () => {
  const status = mapReadinessToClientConnectStatus({
    readiness: {
      audience: "client",
      readiness_status: "checking_connection",
      client_status: "checking_connection",
      client_message: "",
      assignment_status: "ready",
      phone_available: true,
      app_instance_available: true,
      preflight_request_created: false,
      idempotent: true,
      request_id: null,
      run_request_status: "queued",
      next_action: "monitor_preflight",
      reason: "already_requested",
      blockers: [],
      checks: {},
    },
  });
  assert.equal(status, "already_queued");
});

test("mapReadinessToClientConnectStatus returns running for active run request", () => {
  const status = mapReadinessToClientConnectStatus({
    readiness: {
      audience: "client",
      readiness_status: "checking_connection",
      client_status: "checking_connection",
      client_message: "",
      assignment_status: "ready",
      phone_available: true,
      app_instance_available: true,
      preflight_request_created: false,
      idempotent: true,
      request_id: null,
      run_request_status: "running",
      next_action: "monitor_preflight",
      reason: "already_requested",
      blockers: [],
      checks: {},
    },
  });
  assert.equal(status, "running");
});

test("connect route always returns JSON contract helpers", () => {
  const route = readFileSync(
    new URL("../../app/api/instagram-client/accounts/[accountId]/connect/route.ts", import.meta.url),
    "utf8",
  );
  const response = readFileSync(
    new URL("../../app/api/instagram-client/accounts/[accountId]/connect/connect-response.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /clientConnectOk/);
  assert.match(route, /clientConnectError/);
  assert.match(route, /try \{/);
  assert.match(response, /NextResponse\.json/);
});

test("client connect messages never expose JSON.parse or RPC errors", () => {
  for (const status of [
    "queued",
    "already_queued",
    "running",
    "verification_required",
    "verification_code_submitted",
    "connected",
    "blocked",
    "not_created",
    "failed",
  ]) {
    const message = clientConnectMessage(status, "fr");
    assert.doesNotMatch(message, /JSON\.parse/i);
    assert.doesNotMatch(message, /invalid_actor_type/i);
    assert.doesNotMatch(message, /rpc/i);
  }
});

test("ClientAccountsSection connect flow uses robust API body parsing", () => {
  const ui = readFileSync(new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url), "utf8");
  const connectSection = ui.slice(ui.indexOf("async function runConnectProcess"), ui.indexOf("const showGlobalRefresh"));
  assert.match(connectSection, /parseClientApiResponse/);
  assert.doesNotMatch(connectSection, /await response\.json\(\)/);
});
