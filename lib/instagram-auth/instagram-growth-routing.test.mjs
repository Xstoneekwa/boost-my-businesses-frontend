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

test("instagram login always lands on dashboard at top level", () => {
  const loginSource = source("../../app/instagram-login/InstagramLoginClient.tsx");

  assert.match(loginSource, /const dashboardPath = "\/instagram-dashboard"/);
  assert.match(loginSource, /topWindow\.location\.assign\(dashboardPath\)/);
  assert.doesNotMatch(loginSource, /router\.push\("\/instagram-growth"\)/);
  assert.doesNotMatch(loginSource, /searchParams|callbackUrl|redirectTo|next=/);
});
