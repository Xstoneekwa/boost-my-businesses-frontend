import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const domainFiles = [
  "engine-types.ts",
  "engine-policy.ts",
  "engine-utils.ts",
  "identity-engine.ts",
  "assessment-engine.ts",
  "current-projection.ts",
  "replay-harness.ts",
];

test("Target Availability domain does not import React, UI, Supabase, Lifecycle or Premium", () => {
  const violations = domainFiles.flatMap((file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    return [...source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((dependency) => /react|next|supabase|target-lifecycle|ct-premium|components|app\//i.test(dependency))
      .map((dependency) => `${file}:${dependency}`);
  });
  assert.deepEqual(violations, []);
});

test("Availability domain contains no lifecycle or business action vocabulary", () => {
  const source = domainFiles.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(source, /replacement_recommended|replacement_pending|archive_target|send_email|notify_client|follow_performance|utilization_ratio/);
});

test("all policy thresholds are centralized and versioned", () => {
  const policy = readFileSync(path.join(root, "engine-policy.ts"), "utf8");
  const assessment = readFileSync(path.join(root, "assessment-engine.ts"), "utf8");
  assert.match(policy, /TARGET_AVAILABILITY_SIGNAL_RULES/);
  assert.match(policy, /TARGET_AVAILABILITY_RULE_VERSION/);
  assert.doesNotMatch(assessment, /repeatRequired:\s*\d/);
});
