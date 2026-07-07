import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const buttonSource = readFileSync(new URL("./ReadyToResumeButton.tsx", import.meta.url), "utf8");

test("P3.1 Admin incidents page reads incident_id deep-link from searchParams", () => {
  assert.match(pageSource, /params\.incident_id/);
  assert.match(pageSource, /focusedIncidentId/);
  assert.match(pageSource, /loadFocusedIncident/);
});

test("P3.1 deep-linked incident is loaded even when test incidents are hidden", () => {
  // Explicit load by id bypasses the default includeTest filter.
  assert.match(pageSource, /await loadFocusedIncident\(supabase, focusedIncidentId\)/);
  assert.match(pageSource, /if \(focused && !models\.some/);
  assert.match(pageSource, /models = \[focused\.model, \.\.\.models\]/);
});

test("P3.1 focused incident panel shows recovery context and Prêt à relancer when eligible", () => {
  assert.match(pageSource, /data-testid="incident-focused-detail"/);
  assert.match(pageSource, /Reprise contrôlée/);
  assert.match(pageSource, /ReadyToResumeButton/);
  assert.match(pageSource, /focused\.recovery\.eligible/);
  assert.match(pageSource, /recoveryReasonLabel/);
});

test("P3.1 armed state label is distinct from the Prêt à relancer button", () => {
  assert.match(pageSource, /ready_to_resume.*Reprise autorisée — en attente du prochain tick/s);
  assert.doesNotMatch(pageSource, /return "Prêt à relancer"/);
  assert.match(buttonSource, /Prêt à relancer/);
});

test("P3.1 Admin ready-to-resume button is status-only and never creates a run", () => {
  assert.match(buttonSource, /action: "ready_to_resume"/);
  assert.match(buttonSource, /\/api\/instagram-dashboard\/incidents\/action/);
  assert.doesNotMatch(buttonSource, /runCreated|create_account_run_request|ig_runs/);
});

test("P3.1 deep-linked row is highlighted in the list", () => {
  assert.match(pageSource, /ig-inc-row-focused/);
  assert.match(pageSource, /id=\{`incident-\$\{incident\.id\}`\}/);
});
