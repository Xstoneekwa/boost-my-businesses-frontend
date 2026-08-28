import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(compile(read("./human-review-feedback.ts"))).toString("base64")}`);
const event = (id, type, metadata = {}) => ({ lead_id: id, event_type: type, occurred_at: "2026-08-28T00:00:00Z", metadata_safe: { canary_key: m.HUMAN_REVIEW_CANARY_KEY, ...metadata } });
const enrolled = (id, priority = "urgent", score = 84) => event(id, "human_review_canary_enrolled", { ai_priority: priority, ai_score: score, ai_channel: "instagram", ai_angle: "A", position: Number(id) });
const done = (id, overrides = {}) => event(id, "human_review_completed", { human_decision: "approved", human_channel_final: "instagram", human_angle_final: "A", lead_edited: false, review_duration_seconds: 10, ...overrides });
const item = (id, overrides = {}) => ({ lead_id: id, state: "ready_for_review", channel: "instagram", angle: "A", body: "Local fixture", validation_codes: [], generation_attempt_count: 1, max_generation_attempts: 2, ...overrides });

test("no historical or synthetic reviews, no fake percentages before Liam acts", () => {
  const result = m.buildHumanReviewFeedback([enrolled("1"), event("old", "lead_approved"), done("outside")], [], []);
  assert.equal(result.reviewed, 0); assert.equal(result.pending, 1);
  assert.equal(result.p1.percent, null); assert.equal(result.channelAgreement.percent, null);
  assert.equal(result.medianSeconds, null); assert.equal(result.editRate.percent, null);
});
test("P1/P2, original AI score bands, channel and angle agreement, edit/reject aggregation", () => {
  const events = [enrolled("1"), enrolled("2"), enrolled("3", "high", 79), enrolled("4", "high", 78),
    done("1"), done("2", { human_decision: "rejected", reject_reason: "not_a_fit", review_duration_seconds: 20 }),
    done("3", { human_channel_final: "email", lead_edited: true, review_duration_seconds: 30 }),
    done("4", { human_angle_final: "B", lead_edited: true, review_duration_seconds: 40 })];
  const result = m.buildHumanReviewFeedback(events, [], []);
  assert.equal(result.p1.percent, 50); assert.equal(result.p2.percent, 100);
  assert.equal(result.channelAgreement.percent, 2 / 3 * 100); assert.equal(result.angleAgreement.percent, 2 / 3 * 100);
  assert.equal(result.channelAgreement.total, 3); assert.equal(result.angleAgreement.total, 3);
  assert.equal(result.editRate.percent, 50); assert.equal(result.rejectRate.percent, 25);
  assert.equal(result.medianSeconds, 25); assert.equal(result.p90Seconds, 37);
  assert.deepEqual(result.rejectionReasons, [{ reason: "not_a_fit", count: 1 }]);
  assert.equal(result.scoreBands.find((b) => b.label === "8.0–8.4").percent, 50);
  assert.equal(result.scoreBands.find((b) => b.label === "7.5–7.9").percent, 100);
});
test("rejecting a lead does not implicitly endorse its channel or angle", () => {
  const result = m.buildHumanReviewFeedback([enrolled("1"), done("1", { human_decision: "rejected", reject_reason: "not_a_fit" })], [], []);
  assert.equal(result.reviewed, 1); assert.equal(result.rejectRate.percent, 100);
  assert.equal(result.channelAgreement.total, 0); assert.equal(result.channelAgreement.percent, null);
  assert.equal(result.angleAgreement.total, 0); assert.equal(result.angleAgreement.percent, null);
});
test("replays deduplicate, priority comes from enrollment even after human priority edit", () => {
  const decision = done("1", { ai_priority: "high" });
  const result = m.buildHumanReviewFeedback([enrolled("1"), decision, decision], [], []);
  assert.equal(result.reviewed, 1); assert.equal(result.p1.total, 1); assert.equal(result.p2.total, 0);
});
test("funnel requires matching, valid current dry-run previews and distinguishes failures", () => {
  const events = ["1", "2", "3", "4"].flatMap((id) => [enrolled(id), done(id)]);
  const result = m.buildHumanReviewFeedback(events, [item("1", { state: "queued_dry_run" }), item("2", { angle: "B" }), item("3", { state: "generation_failed", generation_attempt_count: 2 })], []);
  assert.equal(result.validPreviews, 1); assert.equal(result.approvedWithoutPreview, 3);
  assert.equal(result.terminalFailures, 1); assert.equal(result.missingItems, 1);
  assert.deepEqual(result.funnel.map((s) => s.count), [4, 4, 4, 4, 1, 1]);
  assert.doesNotMatch(result.funnel.map((s) => s.label).join(), /sent|replies|demo|paid/i);
});
test("completion requires all 15 P1 and 10 P2; missing observations do not become agreement", () => {
  const events = Array.from({ length: 25 }, (_, n) => [enrolled(String(n), n < 15 ? "urgent" : "high"), done(String(n))]).flat();
  assert.equal(m.buildHumanReviewFeedback(events, [], []).complete, true);
  const incomplete = m.buildHumanReviewFeedback(events.slice(0, -1), [], []);
  assert.equal(incomplete.complete, false); assert.equal(incomplete.pending, 1);
  const unknown = m.buildHumanReviewFeedback([enrolled("1"), done("1", { human_channel_final: null, review_duration_seconds: null })], [], []);
  assert.equal(unknown.channelAgreement.total, 0); assert.equal(unknown.medianSeconds, null);
});
test("new analytics/start routes and read service are owner gated; browser visit is not a review", () => {
  for (const path of ["./human-review-feedback-service.ts", "../../app/api/instagram-dashboard/commercial/review-quality/route.ts", "../../app/api/instagram-dashboard/commercial/leads/[leadId]/review/start/route.ts"]) assert.match(read(path), /await requireCommercialCrmAccess\(\)/);
  const ui = read("../../app/instagram-dashboard/commercial/CommercialLeadReviewQueue.tsx");
  assert.match(ui, /\[reviewSessionActive, setReviewSessionActive\] = useState\(false\)/);
  assert.match(ui, /if \(!reviewSessionActive \|\| !memberId/);
  assert.match(read("../../app/api/instagram-dashboard/commercial/leads/[leadId]/review/route.ts"), /mutation.action === "approve"\) after/);
});
test("generation exceptions persist as failures and remain dry-run only", async () => {
  let source = read("./outreach-processor.ts").replace(/^import [^;]+;\n/gm, "");
  source = `const COMMERCIAL_OUTREACH_PROMPT_VERSION="fixture"; const buildCommercialOutreachFactLedger=()=>[{key:"business_name"},{key:"city"}];\n` + source;
  const processor = await import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString("base64")}`);
  const calls = [];
  const fakeDb = {
    from(table) { return { select() { return this; }, eq() { return this; }, neq() { return this; }, limit: async () => ({ data: [] }),
      single: async () => ({ data: table === "commercial_leads" ? { id: "1", business_id: "b", qualification_status: "approved", outreach_status: "not_started" } : table === "commercial_outreach_templates" ? { active: true } : { business_name: "Local fixture" } }) }; },
    async rpc(name, args) { calls.push({ name, args }); return name === "claim_commercial_outreach_items_v1" ? { data: [{ id: "item", lead_id: "1" }] } : { data: {} }; },
  };
  const result = await processor.processCommercialOutreachBatch({ supabase: fakeDb, workerId: "test", generate: async () => { throw new Error("test failure"); } });
  assert.equal(result.failed, 1); assert.equal(result.realEmailSend, false); assert.equal(result.realInstagramDmSend, false);
  assert.equal(calls[1].name, "complete_commercial_outreach_generation_v1");
  assert.deepEqual(calls[1].args.p_validation_codes, ["generation_unexpected_failure"]);
});
