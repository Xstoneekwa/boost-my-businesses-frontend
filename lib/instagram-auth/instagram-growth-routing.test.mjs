import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("instagram growth landing sends dashboard CTA to top-level login", () => {
  const landingSource = source("../../public/instagram-growth/index.html");
  const growthPageSource = source("../../app/instagram-growth/page.tsx");

  assert.match(landingSource, /class="btn-dashboard"[^>]*href="\/instagram-login"/);
  assert.match(landingSource, /class="btn-dashboard"[^>]*target="_top"/);
  assert.doesNotMatch(landingSource, /class="btn-dashboard"[^>]*href="\/instagram-dashboard"/);
  assert.match(growthPageSource, /iframe[\s\S]*src="\/instagram-growth\/index\.html"/);
});

test("instagram login redirects by role after session bootstrap", () => {
  const loginSource = source("../../app/instagram-login/InstagramLoginClient.tsx");
  const postLoginPathSource = source("./post-login-path.ts");

  assert.match(loginSource, /instagramPostLoginPath\(payload\.user\?\.role\)/);
  assert.match(loginSource, /topWindow\.location\.assign\(dashboardPath\)/);
  assert.match(postLoginPathSource, /superadmin[\s\S]*\/instagram-dashboard/);
  assert.match(postLoginPathSource, /\/instagram-client/);
  assert.doesNotMatch(loginSource, /router\.push\("\/instagram-growth"\)/);
});

test("client dashboard route allows tenant users without notFound", () => {
  const clientPageSource = source("../../app/instagram-client/page.tsx");

  assert.match(clientPageSource, /requireInstagramDashboardAccess/);
  assert.match(clientPageSource, /redirect\("\/instagram-dashboard"\)/);
  assert.doesNotMatch(clientPageSource, /notFound\(\)/);
});

test("client dashboard shows setup state when no linked account", () => {
  const sectionSource = source("../../app/instagram-client/ClientAccountsSection.tsx");
  const dashboardSource = source("../../app/instagram-client/ClientDashboard.tsx");

  assert.match(sectionSource, /No Instagram account linked yet/);
  assert.match(sectionSource, /Add Instagram account/);
  assert.match(sectionSource, /isEmpty \?/);
  assert.match(dashboardSource, /ClientAccountsSection/);
  assert.match(dashboardSource, /accounts=\{\[\]\}/);
});
