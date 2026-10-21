import test from "node:test";
import assert from "node:assert/strict";
import { secondaryMetadata, secondaryPages, secondaryPaths } from "./secondary-seo";
import { marketingPages, marketingPaths, PUBLIC_ORIGIN } from "./seo";

test("all public SEO entries have unique titles, descriptions and self-canonicals", () => {
  const all = [...Object.values(marketingPages), ...Object.values(secondaryPages)];
  assert.equal(new Set(all.map(p => p.title)).size, all.length);
  assert.equal(new Set(all.map(p => p.description)).size, all.length);
  assert.equal(marketingPaths.length, 9, "analytics registry is unchanged");
  assert.equal(secondaryPaths.length, 8);
  for (const path of secondaryPaths) {
    const metadata = secondaryMetadata(path);
    assert.equal(metadata.alternates?.canonical, PUBLIC_ORIGIN + path);
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.ok(!/checkout|dashboard|\/api\/|\/admin|\/agent\/(general|support|sales)$/.test(path));
  }
});
