import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("./20260814212322_commercial_dashboard_read_model_v1.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../rollback/20260814212322_commercial_dashboard_read_model_v1.down.sql", import.meta.url), "utf8");

test("dashboard RPC uses canonical tables and bounded pagination", () => {
  assert.match(migration, /from public\.commercial_leads l/i);
  assert.match(migration, /left join public\.commercial_conversions cv/i);
  assert.match(migration, /from public\.commercial_events[\s\S]*limit 1/i);
  assert.match(migration, /least\(greatest\(coalesce\(p_page_size, 25\), 1\), 100\)/i);
});

test("paid KPI is conversion-backed and small samples are explicit", () => {
  assert.match(migration, /\(cv\.id is not null\) as is_paid/i);
  assert.match(migration, /minimum_qualified_sample', 20/i);
  assert.match(migration, /case when s\.qualified >= 20[\s\S]*paid_per_100_qualified/i);
});

test("dashboard indexes target cohort windows and stable pagination", () => {
  assert.match(migration, /commercial_leads_created_dashboard_idx[\s\S]*created_at desc, id desc/i);
  assert.match(migration, /commercial_leads_updated_dashboard_idx[\s\S]*updated_at desc, id desc/i);
});

test("dashboard read model has an exact scoped rollback", () => {
  assert.match(rollback, /drop function if exists public\.commercial_dashboard_read_model_v1/i);
  assert.match(rollback, /drop index if exists public\.commercial_leads_created_dashboard_idx/i);
  assert.match(rollback, /drop index if exists public\.commercial_leads_updated_dashboard_idx/i);
  assert.doesNotMatch(rollback, /drop table|delete from|truncate/i);
});
