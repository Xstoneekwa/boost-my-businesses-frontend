import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("instagram session route sets httpOnly access and refresh cookies for seven days", () => {
  const routeSource = source("../../app/api/instagram-auth/session/route.ts");
  const cookieSource = source("./cookies.ts");

  assert.match(routeSource, /writeInstagramAuthCookies/);
  assert.match(cookieSource, /INSTAGRAM_AUTH_ACCESS_COOKIE/);
  assert.match(cookieSource, /INSTAGRAM_AUTH_REFRESH_COOKIE/);
  assert.match(cookieSource, /httpOnly:\s*true/);
  assert.match(cookieSource, /sameSite:\s*"lax"/);
  assert.match(cookieSource, /path:\s*"\/"/);
  assert.match(cookieSource, /maxAge:\s*INSTAGRAM_AUTH_COOKIE_MAX_AGE_SECONDS/);
  assert.match(cookieSource, /60 \* 60 \* 24 \* 7/);
});

test("instagram dashboard access refreshes expired access tokens with refresh cookie", () => {
  const sessionSource = source("../restaurant-analytics/session.ts");
  const resolveSource = source("./resolve-user-context.ts");
  const refreshSource = source("./refresh-session.ts");

  assert.match(sessionSource, /resolveInstagramUserContextFromCookies/);
  assert.match(resolveSource, /refreshInstagramAuthSession/);
  assert.match(resolveSource, /writeInstagramAuthCookies/);
  assert.match(resolveSource, /clearInstagramAuthCookies/);
  assert.match(refreshSource, /auth\.refreshSession/);
});

test("invalid refresh token clears instagram cookies without logging secrets", () => {
  const resolveSource = source("./resolve-user-context.ts");
  const routeSource = source("../../app/api/instagram-auth/session/route.ts");

  assert.match(resolveSource, /await clearInstagramAuthCookies\(\)/);
  assert.equal(resolveSource.includes("console.log"), false);
  assert.equal(routeSource.includes("access_token"), true);
  assert.equal(routeSource.includes("console.log"), false);
  assert.equal(
    routeSource.split("\n").some((line) => /^\s*access_token:/.test(line) && line.includes("accessToken")),
    false,
  );
});

test("restaurant dashboard session helpers stay separate from instagram auth", () => {
  const sessionSource = source("../restaurant-analytics/session.ts");
  const utilsSource = readFileSync(
    new URL("../../app/api/instagram-dashboard/_utils.ts", import.meta.url),
    "utf8",
  );

  assert.match(sessionSource, /RESTAURANT_AUTH_ACCESS_COOKIE/);
  assert.match(sessionSource, /getDashboardUserContext/);
  assert.match(sessionSource, /requireDashboardUserContext/);
  assert.doesNotMatch(sessionSource, /RESTAURANT_AUTH_REFRESH_COOKIE[\s\S]*refreshInstagramAuthSession/);
  assert.match(utilsSource, /getInstagramUserContext/);
  assert.match(utilsSource, /requireInstagramAdmin/);
  assert.doesNotMatch(utilsSource, /getDashboardUserContext/);
});

test("instagram dashboard pages use instagram dashboard access guard", () => {
  const pageSource = readFileSync(
    new URL("../../app/instagram-dashboard/credentials-actions/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /requireInstagramDashboardAccess/);
  assert.doesNotMatch(pageSource, /requireDashboardUserContext/);
});
