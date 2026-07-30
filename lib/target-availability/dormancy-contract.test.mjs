import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "../..");
const runtimeRoots = ["app", "lib"];
const newDomainModules = [
  "identity-engine",
  "assessment-engine",
  "current-projection",
  "replay-harness",
];

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = path.join(directory, entry);
    if (entry === "node_modules" || entry === ".next") return [];
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(?:mjs|cjs|js|jsx|ts|tsx)$/.test(entry) ? [absolute] : [];
  });
}

test("V1 domain modules have only the approved Target Availability pipeline caller", () => {
  const violations = runtimeRoots
    .flatMap((root) => sourceFiles(path.join(repositoryRoot, root)))
    .filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
    .filter((file) => !file.endsWith("/lib/target-availability/replay-harness.ts"))
    .filter((file) => !file.endsWith("/lib/target-availability/replay-cli.ts"))
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return newDomainModules
        .filter((moduleName) => source.includes(moduleName))
        .map((moduleName) => `${path.relative(repositoryRoot, file)}:${moduleName}`);
    });

  assert.deepEqual(violations.sort(), [
    "lib/target-availability/runtime-pipeline.ts:assessment-engine",
    "lib/target-availability/runtime-pipeline.ts:current-projection",
    "lib/target-availability/runtime-pipeline.ts:identity-engine",
  ]);
});

test("replay remains an explicit operator command and is not wired into build or start", () => {
  const pkg = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const automaticScripts = Object.entries(pkg.scripts ?? {})
    .filter(([name]) => /^(?:pre|post)?(?:build|start|dev|install)$/.test(name))
    .map(([name, command]) => `${name}:${command}`);

  assert.equal(typeof pkg.scripts?.["replay:target-availability"], "string");
  assert.equal(automaticScripts.some((entry) => /replay:target-availability|replay-cli|replay-harness/.test(entry)), false);
});

test("new domain code contains no persistence client or production table access", () => {
  const sources = [
    "engine-types.ts",
    "engine-policy.ts",
    "engine-utils.ts",
    "identity-engine.ts",
    "assessment-engine.ts",
    "current-projection.ts",
    "replay-harness.ts",
  ].map((file) => readFileSync(path.join(moduleRoot, file), "utf8")).join("\n");

  assert.doesNotMatch(sources, /createClient|SupabaseClient|\.from\s*\(|ct_target_(?:identity|availability)/);
});
