import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio.ts";

test("targeted discovery expands a subsegment with controlled business synonyms", () => {
  const queries = buildCommercialDiscoveryQueries("Johannesburg", "Beauty Salon");
  assert.equal(queries.length, 6);
  assert.ok(queries.some((query) => query.includes('"beauty salon"')));
  assert.ok(queries.some((query) => query.includes('"beauty studio"')));
  assert.ok(queries.some((query) => query.includes('"beauty bar"')));
  assert.ok(queries.every((query) => query.includes('"Johannesburg"')));
  assert.equal(new Set(queries).size, queries.length);
});

test("broad discovery keeps its bounded ten-query portfolio", () => {
  const queries = buildCommercialDiscoveryQueries("Cape Town");
  assert.equal(queries.length, 10);
  assert.ok(queries.every((query) => query.startsWith("site:instagram.com/")));
});
