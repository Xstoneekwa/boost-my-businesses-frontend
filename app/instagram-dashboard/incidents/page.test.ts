import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const buttonSource = readFileSync(new URL("./ReadyToResumeButton.tsx", import.meta.url), "utf8");
const markReviewedSource = readFileSync(new URL("./MarkReviewedButton.tsx", import.meta.url), "utf8");

const FORBIDDEN_FRENCH = [
  "Prêt à relancer",
  "Reprise autorisée",
  "Reprise contrôlée",
  "Fenêtre de reprise",
  "Armée — en attente",
  "Nouvelle intervention requise",
  "Action requise",
  "Résolu",
];

test("P3.2 Admin incidents page reads incident_id deep-link from searchParams", () => {
  assert.match(pageSource, /params\.incident_id/);
  assert.match(pageSource, /focusedIncidentId/);
  assert.match(pageSource, /loadFocusedIncident/);
});

test("P3.2 deep-linked incident is loaded even when test incidents are hidden", () => {
  assert.match(pageSource, /await loadFocusedIncident\(supabase, focusedIncidentId\)/);
  assert.match(pageSource, /if \(focused && !models\.some/);
  assert.match(pageSource, /models = \[focused\.model, \.\.\.models\]/);
});

test("P3.2 focused incident panel shows Controlled recovery and Ready to resume when eligible", () => {
  assert.match(pageSource, /data-testid="incident-focused-detail"/);
  assert.match(pageSource, /Controlled recovery/);
  assert.match(pageSource, /ReadyToResumeButton/);
  assert.match(pageSource, /focused\.recovery\.eligible/);
  assert.match(pageSource, /recoveryReasonLabel/);
});

test("P3.2 armed state label is distinct from the Ready to resume button", () => {
  assert.match(pageSource, /ready_to_resume.*Resume authorized — awaiting next tick/s);
  assert.match(buttonSource, /Ready to resume/);
});

test("P3.2 Admin ready-to-resume button is status-only and never creates a run", () => {
  assert.match(buttonSource, /action: "ready_to_resume"/);
  assert.match(buttonSource, /\/api\/instagram-dashboard\/incidents\/action/);
  assert.doesNotMatch(buttonSource, /runCreated|create_account_run_request|ig_runs/);
});

test("P3.2 deep-linked row is highlighted in the list", () => {
  assert.match(pageSource, /ig-inc-row-focused/);
  assert.match(pageSource, /id=\{`incident-\$\{incident\.id\}`\}/);
});

test("operator review actions expose a terminal Mark reviewed control without touching incidents", () => {
  assert.match(pageSource, /operator_review_required/);
  assert.match(pageSource, /MarkReviewedButton/);
  assert.match(pageSource, /reviewActions\.has/);
  assert.match(markReviewedSource, /Mark reviewed/);
  assert.match(markReviewedSource, /dashboard-actions\/review/);
  assert.match(markReviewedSource, /review_status: "reviewed"/);
  assert.match(markReviewedSource, /Confirm this action has been reviewed by a human operator/);
  assert.match(markReviewedSource, /Review note \(optional\)/);
  assert.match(markReviewedSource, /Confirm review/);
  assert.match(markReviewedSource, /Cancel/);
  assert.doesNotMatch(markReviewedSource, /account_incidents|incidents\/action/);
});

test("P3.2 Admin incidents UI has no forbidden French operator strings", () => {
  for (const phrase of FORBIDDEN_FRENCH) {
    assert.doesNotMatch(pageSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(buttonSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
