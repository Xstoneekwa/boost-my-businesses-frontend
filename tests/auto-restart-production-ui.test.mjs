import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const UI_FILES = [
  "../components/instagram-dashboard/AutoRestartRulesEditor.tsx",
  "../app/instagram-dashboard/auto-restart/page.tsx",
];

const FORBIDDEN_COPY = /Preview only|Dry-run mode|Read-only — backend migration|Current mode: Dry-run|dry_run preview/i;

test("Auto Restart admin UI has no preview framing or fake read-only copy", () => {
  const editor = readFileSync(new URL("../components/instagram-dashboard/AutoRestartRulesEditor.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/instagram-dashboard/auto-restart/page.tsx", import.meta.url), "utf8");
  for (const [name, source] of [["editor", editor], ["page", page]]) {
    assert.doesNotMatch(source, FORBIDDEN_COPY, `${name} must not contain preview framing copy`);
    assert.match(source, /Production/);
  }
  assert.match(editor, /Run dry-run check/);
});

test("Auto Restart admin layout avoids page-level horizontal overflow patterns", () => {
  const page = readFileSync(new URL("../app/instagram-dashboard/auto-restart/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /min-width:\s*1100px/);
  assert.doesNotMatch(page, /repeat\(3,/);
  assert.match(page, /minmax\(0,\s*1fr\)|minmax\(min\(100%/);
  assert.match(page, /overflow-x:\s*clip|overflow-wrap:\s*anywhere/);
});

test("Auto Restart blocked state uses single foundation message", () => {
  const page = readFileSync(new URL("../app/instagram-dashboard/auto-restart/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Blocked — automation foundation is not available\./);
  assert.doesNotMatch(page, /Read-only — backend migration required before editing/);
});
