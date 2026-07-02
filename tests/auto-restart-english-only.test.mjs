import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const FRENCH_PATTERN = /Aperçu|Réglages|Désactivé|Rafraîchir|Surveillance|aperçu|désactivé|Garde-fous|Comptes concernés|Les réglages canoniques/i;

test("Admin Auto Restart surfaces remain English-only", () => {
  const files = [
    "components/instagram-dashboard/AutoRestartRulesEditor.tsx",
    "app/instagram-dashboard/auto-restart/page.tsx",
  ];
  for (const relativePath of files) {
    const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, FRENCH_PATTERN, `${relativePath} must not contain French UI copy`);
  }
});
