import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function readRepo(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
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

test("session GET route refreshes and persists cookies via route-handler helper", () => {
  const routeSource = source("../../app/api/instagram-auth/session/route.ts");
  const resolveSource = source("./resolve-user-context.ts");

  assert.match(routeSource, /refreshInstagramUserContextFromCookies/);
  assert.match(resolveSource, /allowCookieMutation/);
  assert.match(resolveSource, /refreshInstagramUserContextFromCookies/);
});

test("instagram dashboard page render uses read-only auth without cookie mutation", () => {
  const sessionSource = source("../restaurant-analytics/session.ts");
  const resolveSource = source("./resolve-user-context.ts");
  const dashboardPage = readRepo("app/instagram-dashboard/page.tsx");

  assert.match(sessionSource, /getInstagramUserContextReadOnly/);
  assert.match(sessionSource, /requireInstagramDashboardAccess[\s\S]*getInstagramUserContextReadOnly/);
  assert.match(resolveSource, /allowCookieMutation\s*=\s*false/);
  assert.match(dashboardPage, /requireInstagramDashboardAccess/);
  assert.doesNotMatch(dashboardPage, /writeInstagramAuthCookies/);
  assert.doesNotMatch(dashboardPage, /clearInstagramAuthCookies/);
});

test("route handlers may refresh expired access tokens and persist cookies", () => {
  const sessionSource = source("../restaurant-analytics/session.ts");
  const resolveSource = source("./resolve-user-context.ts");
  const refreshSource = source("./refresh-session.ts");
  const utilsSource = readRepo("app/api/instagram-dashboard/_utils.ts");

  assert.match(sessionSource, /getInstagramUserContext[\s\S]*allowCookieMutation:\s*true/);
  assert.match(resolveSource, /refreshInstagramAuthSession/);
  assert.match(resolveSource, /if \(allowCookieMutation\)/);
  assert.match(refreshSource, /auth\.refreshSession/);
  assert.match(utilsSource, /getInstagramUserContext/);
  assert.match(utilsSource, /requireInstagramAdmin/);
});

test("without session dashboard guard redirects to instagram login", () => {
  const sessionSource = source("../restaurant-analytics/session.ts");

  assert.match(sessionSource, /requireInstagramDashboardAccess[\s\S]*redirect\("\/instagram-login"\)/);
});

test("non-admin instagram dashboard pages return notFound after auth guard", () => {
  const dashboardPage = readRepo("app/instagram-dashboard/page.tsx");

  assert.match(dashboardPage, /canAccessTenantPages\(userContext\)/);
  assert.match(dashboardPage, /notFound\(\)/);
});

test("invalid refresh token clears instagram cookies only in route-handler mode", () => {
  const resolveSource = source("./resolve-user-context.ts");
  const routeSource = source("../../app/api/instagram-auth/session/route.ts");

  assert.match(resolveSource, /if \(allowCookieMutation\)[\s\S]*clearInstagramAuthCookies/);
  assert.equal(resolveSource.includes("console.log"), false);
  assert.equal(routeSource.includes("console.log"), false);
});

test("restaurant dashboard session helpers stay separate from instagram auth", () => {
  const sessionSource = source("../restaurant-analytics/session.ts");
  const utilsSource = readRepo("app/api/instagram-dashboard/_utils.ts");

  assert.match(sessionSource, /RESTAURANT_AUTH_ACCESS_COOKIE/);
  assert.match(sessionSource, /getDashboardUserContext/);
  assert.match(sessionSource, /requireDashboardUserContext/);
  assert.doesNotMatch(sessionSource, /RESTAURANT_AUTH_REFRESH_COOKIE[\s\S]*refreshInstagramAuthSession/);
  assert.doesNotMatch(utilsSource, /getDashboardUserContext/);
  assert.doesNotMatch(utilsSource, /requireDashboardUserContext/);
});

test("instagram dashboard pages use instagram dashboard access guard", () => {
  const credentialsPage = readRepo("app/instagram-dashboard/credentials-actions/page.tsx");
  const devicesPage = readRepo("app/instagram-dashboard/devices/page.tsx");

  assert.match(credentialsPage, /requireInstagramDashboardAccess/);
  assert.doesNotMatch(credentialsPage, /requireDashboardUserContext/);
  assert.match(devicesPage, /requireInstagramDashboardAccess/);
  assert.doesNotMatch(devicesPage, /requireDashboardUserContext/);
});

test("live-view API routes require instagram admin and stay separate from restaurant auth", () => {
  const startRoute = readRepo("app/api/instagram-dashboard/live-view/start/route.ts");
  const utilsSource = readRepo("app/api/instagram-dashboard/_utils.ts");

  assert.match(startRoute, /requireInstagramAdmin\(\)/);
  assert.doesNotMatch(startRoute, /requireDashboardUserContext/);
  assert.match(utilsSource, /getInstagramUserContext/);
  assert.match(utilsSource, /requireInstagramAdmin/);
});
