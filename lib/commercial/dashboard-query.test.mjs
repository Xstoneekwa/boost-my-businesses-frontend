import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./dashboard-query.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parseCommercialDashboardFilters, commercialFiltersToRpc } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("dashboard query defaults to a deterministic 14-day bounded page", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");
  const filters = parseCommercialDashboardFilters({}, now);
  assert.equal(filters.range, "14d");
  assert.equal(filters.page, 1);
  assert.equal(filters.pageSize, 25);
  assert.equal(filters.dateFrom, "2026-07-31T12:00:00.000Z");
  assert.equal(filters.dateTo, "2026-08-14T12:00:00.000Z");
});

test("dashboard query validates UUID, bounds pagination, and sanitizes all filters", () => {
  const filters = parseCommercialDashboardFilters({
    range: "all", campaign: "not-a-uuid", page: "-2", page_size: "999",
    city: "Johannesburg", subsegment: "Aesthetic Clinic", channel: "instagram",
    message_angle: "A", template_version: "IG_BEAUTY_A_V1", priority: "high",
    qualification_status: "qualified", outreach_status: "not_started", sales_status: "not_started",
    search: "Clinic\u0000 owner@example.test",
  });
  assert.equal(filters.campaign, undefined);
  assert.equal(filters.page, 1);
  assert.equal(filters.pageSize, 100);
  assert.equal(filters.search, "Clinic owner@example.test");
  assert.deepEqual(commercialFiltersToRpc(filters), {
    city: "Johannesburg", subsegment: "Aesthetic Clinic", channel: "instagram",
    message_angle: "A", template_version: "IG_BEAUTY_A_V1", priority: "high",
    qualification_status: "qualified", outreach_status: "not_started", sales_status: "not_started",
    search: "Clinic owner@example.test",
  });
});

test("custom date_to is converted to an inclusive calendar-day boundary", () => {
  const filters = parseCommercialDashboardFilters({ date_from: "2026-08-01", date_to: "2026-08-14" });
  assert.equal(filters.dateFrom, "2026-08-01T00:00:00.000Z");
  assert.equal(filters.dateTo, "2026-08-15T00:00:00.000Z");
});
