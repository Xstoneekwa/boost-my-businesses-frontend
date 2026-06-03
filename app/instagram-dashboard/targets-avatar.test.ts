import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("../api/instagram-dashboard/targets/route.ts", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("./targets-data.ts", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("./InstagramAccountTargetsPanel.tsx", import.meta.url), "utf8");

test("Targets API projects safe persisted avatar_url", () => {
  assert.match(routeSource, /avatar_url: safeInstagramPublicAvatarUrl\(readString\(row\.avatar_url/);
  assert.match(routeSource, /avatar_url: input\.decision\.avatar_url/);
  assert.doesNotMatch(routeSource, /provider_metadata/);
});

test("Targets data maps avatar_url to avatarUrl", () => {
  assert.match(dataSource, /avatarUrl: row\.avatar_url \?\? null/);
});

test("Targets panel renders avatar image with fallback initial", () => {
  assert.match(panelSource, /row\.avatarUrl/);
  assert.match(panelSource, /\/api\/instagram-dashboard\/avatar\?kind=target/);
  assert.match(panelSource, /targetInitial\(row\.targetUsername\)/);
  assert.match(panelSource, /bg-white\/8/);
});
