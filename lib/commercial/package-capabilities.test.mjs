import assert from "node:assert/strict";
import test from "node:test";
import { loadCommercialPackageCapabilities } from "./package-capabilities.ts";

function fakeSupabase(result) {
  const state = { table: "", selected: "", filters: [] };
  const query = {
    select(value) { state.selected = value; return query; },
    eq(column, value) { state.filters.push([column, value]); return query; },
    limit() { return query; },
    async maybeSingle() { return result; },
  };
  return {
    state,
    from(table) { state.table = table; return query; },
  };
}

test("commercial package capabilities come from the active catalogue row", async () => {
  const supabase = fakeSupabase({
    data: { code: "premium", active: true, ai_targeting_enabled: true },
    error: null,
  });
  assert.deepEqual(await loadCommercialPackageCapabilities(supabase, " Premium "), {
    code: "premium",
    aiTargetingEnabled: true,
  });
  assert.equal(supabase.state.table, "commercial_packages");
  assert.deepEqual(supabase.state.filters, [["code", "premium"], ["active", true]]);
});

test("missing, inactive, mismatched, and unreadable catalogue rows fail closed", async () => {
  for (const result of [
    { data: null, error: null },
    { data: { code: "pro", active: false, ai_targeting_enabled: true }, error: null },
    { data: { code: "growth", active: true, ai_targeting_enabled: true }, error: null },
    { data: { code: "pro", active: true, ai_targeting_enabled: true }, error: { message: "read failed" } },
  ]) {
    const projected = await loadCommercialPackageCapabilities(fakeSupabase(result), "pro");
    assert.equal(projected.aiTargetingEnabled, false);
  }
});
