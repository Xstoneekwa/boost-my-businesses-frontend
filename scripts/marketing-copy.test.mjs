import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const baseline = JSON.parse(fs.readFileSync(new URL("./marketing-dash-baseline.json", import.meta.url)));
const rewrites = JSON.parse(fs.readFileSync(new URL("./marketing-copy-rewrites.json", import.meta.url)));
test("only individually reviewed copy replacements change application sources", () => {
  for (const file of new Set(rewrites.map(r => r.file))) {
    let expected = execFileSync("git", ["show", `${baseline.sha}:${file}`], {encoding: "utf8"});
    for (const {before, after} of rewrites.filter(r => r.file === file)) {
      assert.ok(expected.includes(before), `${file}: original copy exists`);
      expected = expected.replaceAll(before, after);
    }
    if (file === "public/instagram-growth/index.html") {
      const approved = execFileSync("git", ["show", "0c1417eb3867cd18709d572919424c4e802bd468:public/instagram-growth/index.html"], {encoding:"utf8"});
      for (const [anchor, addition] of [['<link rel="stylesheet" href="styles.css" />','<link rel="stylesheet" href="immersive-local.css" />'], ['<script src="app.js"></script>','<script src="immersive-local.js"></script>']]) {
        assert.equal(approved.split(addition).length-1,1);
        assert.ok(approved.includes(anchor+"\n"+addition));
        assert.equal(expected.split(anchor).length-1,1);
        expected=expected.replace(anchor,anchor+"\n"+addition);
      }
    }
    assert.equal(fs.readFileSync(file, "utf8"), expected, `${file}: no design, code or destination delta`);
  }
});
test("complete marketing punctuation guard passes", () => {
  assert.match(execFileSync(process.execPath, ["scripts/audit-marketing-dashes.mjs", "--guard"], {encoding: "utf8"}), /COPY_DASH_GUARD=PASS/);
});
test("official plan separators and owner-requested wording are preserved", () => {
  const html = fs.readFileSync("public/instagram-growth/index.html", "utf8");
  for (const name of ["Growth", "Pro", "Premium"]) {
    assert.equal(html.split(`Boost AI — ${name}`).length - 1, 2, `${name}: FR and EN names`);
  }
  assert.ok(html.includes("Do it yourself with the Growth plan, or with our AI on the Pro and Premium plans."));
  const hero = fs.readFileSync("app/components/MarketingPages.tsx", "utf8");
  assert.ok(hero.includes("geo-relevant profiles. Our team fully manages"));
  assert.ok(!hero.includes("profiles — using"));
  const audit = JSON.parse(execFileSync(process.execPath, ["scripts/audit-marketing-dashes.mjs"], {encoding: "utf8", maxBuffer: 2e6}));
  assert.equal(audit.counts.VALID_PRODUCT_NAME_KEEP, 6);
});
test("baseline classification is reproducible from the exact Production SHA", () => {
  const audit = JSON.parse(execFileSync(process.execPath, ["scripts/audit-marketing-dashes.mjs", "--ref", baseline.sha], {encoding: "utf8", maxBuffer: 2e6}));
  assert.deepEqual(audit.counts, baseline.counts);
  assert.equal(audit.total, baseline.total);
});
test("technical strings and numeric ranges remain intact", () => {
  const audit = JSON.parse(execFileSync(process.execPath, ["scripts/audit-marketing-dashes.mjs"], {encoding: "utf8", maxBuffer: 2e6}));
  for (const category of ["TECHNICAL_KEEP", "VALID_RANGE_KEEP"]) {
    const originalRows = audit.rows.filter(r => baseline.files.includes(r.file) && r.category === category);
    assert.equal(originalRows.length, baseline.counts[category]);
  }
  for (const term of ["AI-powered", "real-time", "white-label", "e-commerce", "14-day", "12-month"]) assert.ok(audit.terms.some(t => t.toLowerCase() === term.toLowerCase()), term);
});
