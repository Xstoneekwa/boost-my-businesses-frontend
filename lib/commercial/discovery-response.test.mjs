import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../app/instagram-dashboard/commercial/CommercialDiscoveryPanel.tsx", import.meta.url), "utf8");

test("discovery client rejects non-JSON responses before parsing", () => {
  assert.match(source, /contentType\.toLowerCase\(\)\.includes\("application\/json"\)/);
  assert.match(source, /non-JSON response/);
  assert.match(source, /try \{[\s\S]*readApiPayload\(response\)/);
});
