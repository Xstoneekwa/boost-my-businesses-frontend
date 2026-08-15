import assert from "node:assert/strict";
import test from "node:test";
import { parseCommercialOutreachReadFilters, type CommercialOutreachItem, type CommercialOutreachQueueItem } from "./outreach-contract";
import { filterOutreachQueueItems, nextOutreachItemId, outreachActionAvailability, outreachTabMatchesState } from "./outreach-ui";

const queueItems: CommercialOutreachQueueItem[] = [
  { id: "a", businessName: "Glow Studio", city: "Cape Town", subsegment: "Beauty", priority: "high", score: 8.7, channel: "instagram", angle: "A", templateKey: "IG_BEAUTY_ANGLE_A_V1", templateVersion: "V1", state: "ready_for_review", confidence: .91, attemptCount: 1, maxAttempts: 2, messageExcerpt: "A tailored opening for Glow Studio", ownerEdited: false, version: 1, updatedAt: "2026-08-16T10:00:00Z" },
  { id: "b", businessName: "Skin Atelier", city: "Johannesburg", subsegment: "Aesthetics", priority: "normal", score: 7.4, channel: "email", angle: "B", templateKey: "EMAIL_BEAUTY_ANGLE_B_V1", templateVersion: "V1", state: "cancelled", confidence: .84, attemptCount: 2, maxAttempts: 2, messageExcerpt: "An email preview", ownerEdited: true, version: 4, updatedAt: "2026-08-16T09:00:00Z" },
];

function detail(state: CommercialOutreachItem["state"]): CommercialOutreachItem {
  return { ...queueItems[0], state, leadId: "lead", campaignId: "campaign", subject: null, body: "Hello", personalizationSummary: null, factsUsed: [], validationCodes: [], generationModel: null, generationPromptVersion: null, generatedAt: null, approvedAt: null, createdAt: "2026-08-16T09:00:00Z", instagramHandle: null, website: null, bookingUrl: null, instagramBio: null, personalizationContext: [], audienceContext: [], history: [] };
}

test("status tabs fail closed to exact durable states", () => {
  assert.equal(outreachTabMatchesState("ready", "ready_for_review"), true);
  assert.equal(outreachTabMatchesState("ready", "cancelled"), false);
  assert.equal(outreachTabMatchesState("cancelled", "cancelled"), true);
  assert.equal(outreachTabMatchesState("all", "generation_failed"), true);
});

test("URL filters default to Ready and reject invalid values", () => {
  assert.deepEqual(parseCommercialOutreachReadFilters({}).status, "ready");
  const parsed = parseCommercialOutreachReadFilters({ outreach_tab: "cancelled", outreach_sort: "confidence", outreach_page: "3", outreach_item: "not-a-uuid" });
  assert.equal(parsed.status, "cancelled");
  assert.equal(parsed.sort, "confidence");
  assert.equal(parsed.page, 3);
  assert.equal(parsed.selectedItemId, undefined);
  assert.equal(parseCommercialOutreachReadFilters({ outreach_tab: "sent" }).status, "ready");
});

test("queue search covers business, city, segment and excerpt without expanding full messages", () => {
  assert.deepEqual(filterOutreachQueueItems(queueItems, "cape town").map((item) => item.id), ["a"]);
  assert.deepEqual(filterOutreachQueueItems(queueItems, "email preview").map((item) => item.id), ["b"]);
  assert.equal(filterOutreachQueueItems(queueItems, "missing").length, 0);
});

test("keyboard navigation stays bounded", () => {
  assert.equal(nextOutreachItemId(queueItems, "a", 1), "b");
  assert.equal(nextOutreachItemId(queueItems, "b", 1), "b");
  assert.equal(nextOutreachItemId(queueItems, "a", -1), "a");
  assert.equal(nextOutreachItemId([], null, 1), null);
});

test("decision controls remain state-aware and never expose transport", () => {
  assert.deepEqual(outreachActionAvailability(detail("ready_for_review")), { approve: true, edit: true, regenerate: true, cancel: true, changeSelection: true });
  assert.deepEqual(outreachActionAvailability(detail("cancelled")), { approve: false, edit: false, regenerate: false, cancel: false, changeSelection: false });
  assert.equal("send" in outreachActionAvailability(detail("ready_for_review")), false);
});
