import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import CommercialAccessState from "../../app/instagram-dashboard/commercial/CommercialAccessState";

const retryPath = "/instagram-dashboard/commercial/structured" as const;

test("missing/expired session redirects to login, not 404/500", () => {
  assert.throws(() => CommercialAccessState({ status: 401, retryPath }), (error: unknown) => {
    assert.match(String((error as { digest?: string }).digest), /NEXT_REDIRECT;replace;\/instagram-login;307;/);
    return true;
  });
});

test("non-owner gets no commercial data or retry action", () => {
  const html = renderToStaticMarkup(CommercialAccessState({ status: 403, retryPath }));
  assert.match(html, /Accès réservé au propriétaire/);
  assert.doesNotMatch(html, /<form|<table|SIRET|Lancer/);
});

test("authorization outage offers only a read-only GET retry", () => {
  const html = renderToStaticMarkup(CommercialAccessState({ status: 503, retryPath }));
  assert.match(html, /temporairement indisponible/);
  assert.match(html, /method="get"/);
  assert.match(html, /action="\/instagram-dashboard\/commercial\/structured"/);
  assert.doesNotMatch(html, /<table|method="post"|Lancer/);
});

test("both pages handle only typed access errors and retain data-access gates", () => {
  for (const path of ["page.tsx", "structured/page.tsx"]) {
    const source = readFileSync(new URL(`../../app/instagram-dashboard/commercial/${path}`, import.meta.url), "utf8");
    assert.match(source, /error instanceof CommercialCrmAccessError/);
    assert.match(source, /return <CommercialAccessState status=\{error.status\}/);
    assert.match(source, /throw error/);
    assert.doesNotMatch(source, /notFound\(/);
  }
  const service = readFileSync(new URL("./structured-discovery-service.ts", import.meta.url), "utf8");
  assert.match(service, /getStructuredPoc\(\)\s*\{\s*await requireCommercialCrmAccess\(\)/);
});
