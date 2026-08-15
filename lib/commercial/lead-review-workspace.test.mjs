import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadTs(relative) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const contract = await loadTs("./lead-review-contract.ts");
const ui = await loadTs("./lead-review-ui.ts");

test("review URL state is bounded and defaults to the 24-item priority queue", () => {
  const defaults = contract.parseCommercialReviewReadFilters({});
  assert.equal(defaults.sort, "priority");
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 24);

  const parsed = contract.parseCommercialReviewReadFilters({
    review_priority: "urgent",
    review_city: "Cape Town",
    review_subsegment: "Lash Studio",
    review_channel: "instagram",
    review_angle: "B",
    review_score: "80",
    review_sort: "score",
    review_page: "3",
    review_lead: "e0000000-0000-4000-8000-000000000003",
    review_search: "Danielle Jacobs",
  });
  assert.deepEqual(parsed, {
    priority: "urgent",
    city: "Cape Town",
    subsegment: "Lash Studio",
    channel: "instagram",
    angle: "B",
    minimumScore: 80,
    sort: "score",
    page: 3,
    pageSize: 24,
    selectedLeadId: "e0000000-0000-4000-8000-000000000003",
    search: "Danielle Jacobs",
  });
});

test("queue navigation selects the adjacent lead without wrapping", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(ui.nextCommercialReviewLeadId(items, "b", 1), "c");
  assert.equal(ui.nextCommercialReviewLeadId(items, "b", -1), "a");
  assert.equal(ui.nextCommercialReviewLeadId(items, "c", 1), "c");
  assert.equal(ui.nextCommercialReviewLeadId(items, null, 1), "a");
});

test("score and priority labels preserve the existing business mapping", () => {
  assert.equal(ui.commercialReviewScore(92), "9.2");
  assert.equal(ui.commercialReviewPriorityLabel("urgent"), "P1");
  assert.equal(ui.commercialReviewPriorityLabel("high"), "P2");
});
