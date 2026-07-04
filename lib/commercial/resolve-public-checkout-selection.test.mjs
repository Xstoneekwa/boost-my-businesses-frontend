import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  publicCheckoutPricingPath,
  resolvePublicCheckoutSelection,
} from "./resolve-public-checkout-selection.ts";

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
});

describe("public pricing CTA wiring", () => {
  it("links every public pricing card to the intended checkout selection", () => {
    const landing = readFileSync(new URL("../../public/instagram-growth/index.html", import.meta.url), "utf8");
    assert.match(landing, /href="\/instagram-growth\/checkout\?plan=growth&months=1"/);
    assert.match(landing, /href="\/instagram-growth\/checkout\?plan=pro&months=1"/);
    assert.match(landing, /href="\/instagram-growth\/checkout\?plan=premium&months=1"/);
    assert.match(landing, /href="\/instagram-growth\/checkout\?commercial_mode=outreach_only&outreach=outreach_standard&months=1"/);
    assert.match(landing, /href="\/instagram-growth\/checkout\?commercial_mode=outreach_only&outreach=outreach_ai&months=1"/);
    assert.doesNotMatch(landing, /checkout\?plan=pro&outreach=outreach_standard/);
  });

  it("does not hardcode Growth on the public checkout page", () => {
    const page = readFileSync(new URL("../../app/instagram-growth/checkout/page.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(page, /initialPlan="growth"/);
    assert.doesNotMatch(page, /initialMonths=\{1\}/);
  });

  it("exposes a pricing reselection path for invalid checkout URLs", () => {
    assert.equal(publicCheckoutPricingPath(), "/instagram-growth#pricing");
    const form = readFileSync(new URL("../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx", import.meta.url), "utf8");
    assert.match(form, /publicCheckoutPricingPath\(\)/);
    assert.match(form, /selectionBlocked/);
  });
});
