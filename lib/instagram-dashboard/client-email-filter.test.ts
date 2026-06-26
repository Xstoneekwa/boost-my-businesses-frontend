import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeClientEmailFilter,
  recipientEmailMatchesFilter,
} from "./client-email-filter.ts";

test("normalize trims and lowercases exact email filters", () => {
  assert.deepEqual(
    normalizeClientEmailFilter("  Owner@Example.COM "),
    { mode: "exact", value: "owner@example.com" },
  );
});

test("normalize treats short fragments as partial filters", () => {
  assert.deepEqual(
    normalizeClientEmailFilter(" owner "),
    { mode: "partial", value: "owner" },
  );
});

test("recipient snapshot matching is case insensitive for exact filters", () => {
  const filter = normalizeClientEmailFilter("owner@example.com");
  assert.equal(filter?.mode, "exact");
  if (!filter) return;
  assert.equal(recipientEmailMatchesFilter("Owner@Example.com", filter), true);
  assert.equal(recipientEmailMatchesFilter("other@example.com", filter), false);
});

test("partial filter matches recipient snapshot substrings", () => {
  const filter = normalizeClientEmailFilter("hotmail");
  assert.equal(filter?.mode, "partial");
  if (!filter) return;
  assert.equal(recipientEmailMatchesFilter("xstonekwa@hotmail.com", filter), true);
  assert.equal(recipientEmailMatchesFilter("owner@example.com", filter), false);
});
