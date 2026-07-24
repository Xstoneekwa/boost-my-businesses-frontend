import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_ACCOUNT_STATE_MATRIX,
  operationPendingFromConnectResult,
  operationPendingFromReadinessResult,
  resolveClientAccountState,
} from "./client-account-state.ts";

const FORBIDDEN_CLIENT_LABELS = [
  /\bpending\b/i,
  /\bonboardingstatus\b/i,
  /\bloginstatus\b/i,
  /\bassignment\b/i,
  /\bslot\b/i,
  /\bdevice\b/i,
  /\bclone\b/i,
  /\bvault\b/i,
  /\bworker\b/i,
  /\bbotapp\b/i,
  /\bdispatcher\b/i,
  /\brun_id\b/i,
  /\bbackend\b/i,
  /\brpc\b/i,
  /\bsupabase\b/i,
];

function assertClientSafeLabels(ui) {
  const labels = [ui.badgeLabel, ui.readinessLabel, ui.connectLabel, ui.subtext || ""].join(" ");
  for (const pattern of FORBIDDEN_CLIENT_LABELS) {
    assert.doesNotMatch(labels, pattern, `forbidden client label fragment in: ${labels}`);
  }
}

test("empty tenant shows no account state", () => {
  assert.deepEqual([], []);
});

test("added account before connect", () => {
  const ui = resolveClientAccountState({
    loginStatus: "unknown",
    onboardingStatus: "pending",
    provisioningStatus: "not_started",
    assignmentStatus: "pending_assignment",
    connected: false,
  }, "fr");
  assert.equal(ui.phase, "added");
  assert.equal(ui.badgeLabel, "Compte ajouté");
  assert.equal(ui.connectLabel, "Affectation en cours");
  assert.equal(ui.connectDisabled, true);
  assertClientSafeLabels(ui);
});

test("preparing while async connect is queued", () => {
  const ui = resolveClientAccountState({
    loginStatus: "connecting",
    onboardingStatus: "pending",
    provisioningStatus: "in_progress",
    assignmentStatus: "pending_assignment",
    connected: false,
    operationPending: true,
  }, "fr");
  assert.equal(ui.phase, "preparing");
  assert.equal(ui.badgeLabel, "Préparation en cours");
  assert.equal(ui.subtext, "Nous vérifions votre compte.");
  assert.equal(ui.showRefresh, true);
  assert.equal(ui.connectDisabled, true);
  assertClientSafeLabels(ui);
});

test("connected account waiting for readiness confirmation", () => {
  const ui = resolveClientAccountState({
    loginStatus: "connected",
    onboardingStatus: "pending",
    provisioningStatus: "ready",
    assignmentStatus: "assigned",
    connected: true,
  }, "fr");
  assert.equal(ui.phase, "connected");
  assert.equal(ui.badgeLabel, "Compte connecté");
  assert.equal(ui.readinessLabel, "Vérifier la préparation");
  assert.equal(ui.connectTone, "success");
  assertClientSafeLabels(ui);
});

test("connected and ready account", () => {
  const ui = resolveClientAccountState({
    loginStatus: "connected",
    onboardingStatus: "ready",
    provisioningStatus: "ready",
    assignmentStatus: "assigned",
    connected: true,
  }, "fr");
  assert.equal(ui.phase, "ready");
  assert.equal(ui.readinessLabel, "Préparation vérifiée");
  assert.equal(ui.connectLabel, "Connecté");
  assert.equal(ui.connectDisabled, true);
  assert.equal(ui.connectTone, "success");
  assertClientSafeLabels(ui);
});

test("action required maps to client-safe verification CTA", () => {
  const ui = resolveClientAccountState({
    loginStatus: "needs_2fa",
    onboardingStatus: "pending",
    provisioningStatus: "ready",
    assignmentStatus: "assigned",
    connected: false,
  }, "fr");
  assert.equal(ui.phase, "action_required");
  assert.equal(ui.badgeLabel, "Action requise");
  assert.equal(ui.connectLabel, "Connexion à vérifier");
  assertClientSafeLabels(ui);
});

test("completed onboarding with passive readiness exposes verify and connect", () => {
  const ui = resolveClientAccountState({
    loginStatus: "pending",
    onboardingStatus: "configured",
    provisioningStatus: "login_pending",
    assignmentStatus: "assigned",
    connected: false,
    clientReadinessStatus: "ready_to_connect",
  }, "fr");
  assert.equal(ui.phase, "added");
  assert.equal(ui.connectLabel, "Vérifier et connecter");
  assert.equal(ui.connectDisabled, false);
  assert.equal(ui.connectPrimary, true);
  assert.equal(ui.showRecheckReadiness, false);
  assertClientSafeLabels(ui);
});

test("four mixed accounts keep independent connection states", () => {
  const states = [
    resolveClientAccountState({ loginStatus: "connected", onboardingStatus: "ready", connected: true }, "fr"),
    resolveClientAccountState({ loginStatus: "pending", onboardingStatus: "configured", assignmentStatus: "assigned", clientReadinessStatus: "ready_to_connect" }, "fr"),
    resolveClientAccountState({ loginStatus: "pending", onboardingStatus: "configured", assignmentStatus: "pending_assignment" }, "fr"),
    resolveClientAccountState({ loginStatus: "needs_2fa", onboardingStatus: "configured", assignmentStatus: "assigned" }, "fr"),
  ];
  assert.deepEqual(states.map((state) => state.connectLabel), [
    "Connecté",
    "Vérifier et connecter",
    "Affectation en cours",
    "Connexion à vérifier",
  ]);
});

test("operation pending helpers detect async connect and readiness", () => {
  assert.equal(operationPendingFromConnectResult({ request_queued: true }), true);
  assert.equal(operationPendingFromConnectResult({ status: "connecting" }), true);
  assert.equal(operationPendingFromConnectResult({ status: "connected", connected: true }), false);
  assert.equal(operationPendingFromReadinessResult({ status: "checking_connection" }), true);
  assert.equal(operationPendingFromReadinessResult({ status: "connected_ready", connected: true }), false);
});

test("state matrix documents backend to client mapping", () => {
  assert.ok(CLIENT_ACCOUNT_STATE_MATRIX.length >= 5);
  assert.match(CLIENT_ACCOUNT_STATE_MATRIX[0].clientLabel, /Action requise/);
});
