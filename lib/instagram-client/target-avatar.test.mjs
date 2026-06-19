import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clientTargetAvatarProxyPath,
  projectPersistedTargetAvatar,
} from "../instagram-dashboard/target-avatar-projection.ts";
import { enrichBulkTargetLinesWithProvider, mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("projectPersistedTargetAvatar uses ig_targets.avatar_url only when safe", () => {
  const resolved = projectPersistedTargetAvatar("https://cdn.example.com/a.jpg");
  assert.equal(resolved.avatarAvailable, true);
  assert.equal(resolved.avatarSource, "ig_targets.avatar_url");
  const missing = projectPersistedTargetAvatar("");
  assert.equal(missing.avatarAvailable, false);
  assert.equal(missing.avatarSource, null);
});

test("client target avatar proxy path is account and target scoped", () => {
  const path = clientTargetAvatarProxyPath("acct-1", "target-1");
  assert.match(path ?? "", /\/api\/instagram-client\/accounts\/acct-1\/targets\/target-1\/avatar/);
});

test("mapWithConcurrency preserves order", async () => {
  const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => value * 2);
  assert.deepEqual(out, [2, 4, 6, 8]);
});

test("bulk provider enrichment returns avatar status per line", async () => {
  const results = await enrichBulkTargetLinesWithProvider([
    {
      input_username: "demo_user",
      normalized_username: "demo_user",
      line_number: 1,
      status: "pending_verification",
      reason: "queued",
    },
  ], 1);
  assert.equal(results.length, 1);
  assert.equal(typeof results[0].avatarStatus, "string");
  assert.equal(typeof results[0].decision.status, "string");
});

test("client avatar proxy route refreshes avatar via SearchAPI when stored CDN expires", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/targets/[targetId]/avatar/route.ts");
  assert.match(routeSource, /requireClientInstagramSession/);
  assert.match(routeSource, /authorizeClientInstagramAccount/);
  assert.match(routeSource, /resolveTargetAvatarUpstream/);
  assert.match(routeSource, /refreshedFromProvider/);
  assert.doesNotMatch(routeSource, /api_key|INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY/i);
});

test("TargetAvatar component uses client proxy and fallback", () => {
  const componentSource = source("../../app/instagram-client/TargetAvatar.tsx");
  assert.match(componentSource, /clientTargetAvatarImagePath/);
  assert.match(componentSource, /onError/);
  assert.match(componentSource, /avatarAvailable/);
  assert.match(componentSource, /cd-tg2-av/);
});

test("targets service enriches bulk import with provider lookup", () => {
  const serviceSource = source("../instagram-dashboard/targets-service.ts");
  assert.match(serviceSource, /enrichBulkTargetLinesWithProvider/);
  assert.match(serviceSource, /avatar_resolved/);
  assert.match(serviceSource, /avatar_status/);
});

test("avatar proxy fetch failures return null instead of throwing", () => {
  const proxySource = source("./target-avatar-proxy-server.ts");
  assert.match(proxySource, /fetchAvatarBytes/);
  assert.match(proxySource, /AbortSignal\.timeout/);
  assert.match(proxySource, /isExpectedAvatarFetchFailure/);
  assert.match(proxySource, /catch \(error\)/);
});

test("avatar routes return 404 when upstream avatar is unavailable", () => {
  const aiRoute = source("../../app/api/instagram-client/accounts/[accountId]/targets/ai-candidate/avatar/route.ts");
  const targetRoute = source("../../app/api/instagram-client/accounts/[accountId]/targets/[targetId]/avatar/route.ts");
  assert.match(aiRoute, /new NextResponse\(null, \{ status: 404 \}\)/);
  assert.match(targetRoute, /new NextResponse\(null, \{ status: 404 \}\)/);
});

test("mapTargetRow preserves avatarUrl and avatarAvailable from API projection", async () => {
  const { mapTargetRow } = await import("../../app/instagram-dashboard/targets-data.ts");
  const item = mapTargetRow({
    id: "target-1",
    account_id: "acct-1",
    target_username: "dr_dlimi",
    status: "valid",
    source: "client",
    created_at: "2026-06-17T16:03:32.709+00:00",
    updated_at: "2026-06-17T16:03:32.709+00:00",
    avatarUrl: "https://cdn.example.com/a.jpg",
    avatarAvailable: true,
  });
  assert.equal(item.avatarUrl, "https://cdn.example.com/a.jpg");
  assert.equal(item.avatarAvailable, true);
});

test("client targets drawer avoids SSR hydration mismatch on export disabled", () => {
  const drawerSource = source("../../app/instagram-client/ClientAccountTargetsDrawer.tsx");
  assert.match(drawerSource, /\{open \? \(/);
  assert.match(drawerSource, /disabled=\{!canExport\}/);
  assert.doesNotMatch(drawerSource, /disabled=\{rows\.length === 0\}/);
});

test("client targets GET projects avatar fields", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/targets/route.ts");
  assert.match(routeSource, /projectTargetSafeRowsAvatar/);
});

test("client dashboard renders TargetAvatar in ciblage column", () => {
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(dashboardSource, /TargetAvatar/);
  assert.match(dashboardSource, /mainTargetingItems/);
});
