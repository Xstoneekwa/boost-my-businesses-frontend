import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildPublicPricingCheckoutHref,
  PUBLIC_PRICING_OFFER_KEYS,
  publicCheckoutPricingPath,
  resolvePublicCheckoutSelection,
} from "./resolve-public-checkout-selection.ts";

const LANDING_PATH = new URL("../../public/instagram-growth/index.html", import.meta.url);
const APP_JS_PATH = new URL("../../public/instagram-growth/app.js", import.meta.url);
const CHECKOUT_FORM_PATH = new URL("../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx", import.meta.url);
const CHECKOUT_PAGE_PATH = new URL("../../app/instagram-growth/checkout/page.tsx", import.meta.url);

describe("resolvePublicCheckoutSelection", () => {
  it("maps Growth, Pro and Premium monthly full_cycle selections", () => {
    assert.deepEqual(resolvePublicCheckoutSelection({ plan: "growth", months: "1" }), {
      ok: true,
      commercialMode: "full_cycle",
      planKey: "growth",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
    });
    assert.deepEqual(resolvePublicCheckoutSelection({ plan: "pro", months: "1" }), {
      ok: true,
      commercialMode: "full_cycle",
      planKey: "pro",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
    });
    assert.deepEqual(resolvePublicCheckoutSelection({ plan: "premium", months: "1" }), {
      ok: true,
      commercialMode: "full_cycle",
      planKey: "premium",
      billingIntervalMonths: 1,
      outreachAddonKey: null,
    });
  });

  it("maps outreach-only Standard and IA selections without a package", () => {
    assert.deepEqual(resolvePublicCheckoutSelection({
      commercialMode: "outreach_only",
      outreach: "outreach_standard",
      months: "1",
    }), {
      ok: true,
      commercialMode: "outreach_only",
      planKey: null,
      billingIntervalMonths: 1,
      outreachAddonKey: "outreach_standard",
    });
    assert.deepEqual(resolvePublicCheckoutSelection({
      commercialMode: "outreach_only",
      outreach: "outreach_ai",
      months: "1",
    }), {
      ok: true,
      commercialMode: "outreach_only",
      planKey: null,
      billingIntervalMonths: 1,
      outreachAddonKey: "outreach_ai",
    });
  });

  it("does not default invalid or missing selections to Growth", () => {
    assert.equal(resolvePublicCheckoutSelection({ plan: "premium" }).ok, true);
    assert.equal(resolvePublicCheckoutSelection({ plan: "invalid" }).ok, false);
    assert.equal(resolvePublicCheckoutSelection({}).ok, false);
    assert.equal(resolvePublicCheckoutSelection({ plan: "growth", commercialMode: "outreach_only" }).ok, false);
    assert.equal(resolvePublicCheckoutSelection({ commercialMode: "outreach_only" }).ok, false);
    assert.equal(resolvePublicCheckoutSelection({ plan: "pro", outreach: "outreach_standard" }).ok, true);
    assert.equal(
      resolvePublicCheckoutSelection({ plan: "pro", outreach: "outreach_standard" }).commercialMode,
      "full_cycle",
    );
  });

  it("blocks invalid or mixed outreach_only URLs safely", () => {
    assert.equal(
      resolvePublicCheckoutSelection({
        commercialMode: "outreach_only",
        plan: "pro",
        outreach: "outreach_standard",
        months: "1",
      }).code,
      "outreach_only_package_forbidden",
    );
    assert.equal(
      resolvePublicCheckoutSelection({
        commercialMode: "outreach_only",
        plan: "growth",
        outreach: "outreach_ai",
        months: "1",
      }).code,
      "outreach_only_package_forbidden",
    );
    assert.equal(
      resolvePublicCheckoutSelection({
        commercialMode: "full_cycle",
        outreach: "outreach_standard",
        months: "1",
      }).code,
      "full_cycle_package_required",
    );
  });
});

describe("buildPublicPricingCheckoutHref", () => {
  it("builds the five canonical public pricing checkout URLs", () => {
    assert.equal(buildPublicPricingCheckoutHref("growth"), "/instagram-growth/checkout?plan=growth&months=1");
    assert.equal(buildPublicPricingCheckoutHref("pro"), "/instagram-growth/checkout?plan=pro&months=1");
    assert.equal(buildPublicPricingCheckoutHref("premium"), "/instagram-growth/checkout?plan=premium&months=1");
    assert.equal(
      buildPublicPricingCheckoutHref("outreach_standard"),
      "/instagram-growth/checkout?commercial_mode=outreach_only&outreach=outreach_standard&months=1",
    );
    assert.equal(
      buildPublicPricingCheckoutHref("outreach_ai"),
      "/instagram-growth/checkout?commercial_mode=outreach_only&outreach=outreach_ai&months=1",
    );
    assert.deepEqual(PUBLIC_PRICING_OFFER_KEYS, [
      "growth",
      "pro",
      "premium",
      "outreach_standard",
      "outreach_ai",
    ]);
  });
});

describe("public pricing CTA wiring", () => {
  it("links every public pricing card to the intended checkout selection", () => {
    const landing = readFileSync(LANDING_PATH, "utf8");
    for (const offer of PUBLIC_PRICING_OFFER_KEYS) {
      const href = buildPublicPricingCheckoutHref(offer);
      assert.match(landing, new RegExp(`data-checkout-offer="${offer}"`));
      assert.match(landing, new RegExp(`href="${href.replaceAll("?", "\\?")}"`));
    }
    assert.doesNotMatch(landing, /checkout\?plan=pro&outreach=outreach_standard/);
    assert.doesNotMatch(landing, /data-checkout-offer="outreach_standard"[^>]*href="[^"]*plan=(growth|pro|premium)/);
    assert.doesNotMatch(landing, /data-checkout-offer="outreach_ai"[^>]*href="[^"]*plan=(growth|pro|premium)/);
  });

  it("keeps outreach CTAs on outreach_only in the public pricing runtime guard", () => {
    const appJs = readFileSync(APP_JS_PATH, "utf8");
    assert.match(appJs, /syncPublicCheckoutHrefs/);
    assert.match(appJs, /commercial_mode=outreach_only&outreach=outreach_standard&months=1/);
    assert.match(appJs, /commercial_mode=outreach_only&outreach=outreach_ai&months=1/);
    assert.doesNotMatch(appJs, /plan=pro&outreach=outreach_standard/);
  });

  it("does not hardcode Growth on the public checkout page", () => {
    const page = readFileSync(CHECKOUT_PAGE_PATH, "utf8");
    assert.doesNotMatch(page, /initialPlan="growth"/);
    assert.doesNotMatch(page, /initialMonths=\{1\}/);
  });

  it("exposes a pricing reselection path for invalid checkout URLs", () => {
    assert.equal(publicCheckoutPricingPath(), "/instagram-growth#pricing");
    const form = readFileSync(CHECKOUT_FORM_PATH, "utf8");
    assert.match(form, /publicCheckoutPricingPath\(\)/);
    assert.match(form, /selectionBlocked/);
  });
});

describe("outreach_only checkout presentation", () => {
  it("hides the package selector and keeps outreach-only pricing lines", () => {
    const form = readFileSync(CHECKOUT_FORM_PATH, "utf8");
    assert.match(form, /commercialMode === "full_cycle" \? \([\s\S]*<select value=\{planKey\}/);
    assert.match(form, /commercialMode === "outreach_only" && quote\.outreachLine/);
    assert.match(form, /plan_key: commercialMode === "full_cycle" \? planKey : null/);
    assert.match(form, /package_key: commercialMode === "full_cycle" \? planKey : null/);
    assert.match(form, /Offre|Offer/);
  });

  it("documents outreach-only monthly prices at 89 and 149 euros", () => {
    const catalog = readFileSync(new URL("./catalog.ts", import.meta.url), "utf8");
    assert.match(catalog, /outreach_standard:[\s\S]*baseMonthlyPriceCents: 8900/);
    assert.match(catalog, /outreach_ai:[\s\S]*baseMonthlyPriceCents: 14900/);
  });

  it("keeps deliberate full_cycle Pro + Outreach Standard valid", () => {
    const resolved = resolvePublicCheckoutSelection({
      plan: "pro",
      outreach: "outreach_standard",
      months: "1",
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.commercialMode, "full_cycle");
    assert.equal(resolved.planKey, "pro");
    assert.equal(resolved.outreachAddonKey, "outreach_standard");
  });
});
