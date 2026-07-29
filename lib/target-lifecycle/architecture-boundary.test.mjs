import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const lifecycleRoot = path.dirname(fileURLToPath(import.meta.url));
const libRoot = path.dirname(lifecycleRoot);
const premiumRoot = path.join(libRoot, "ct-premium");
const sourceExtensions = new Set([".ts", ".tsx", ".mjs", ".js"]);

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return sourceExtensions.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function importsFor(file) {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)].map((match) => match[1]);
}

function resolveLocalImport(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(file), specifier);
  const candidates = [base, ...[".ts", ".tsx", ".mjs", ".js"].map((extension) => `${base}${extension}`), path.join(base, "index.ts")];
  return candidates.find((candidate) => {
    try { return statSync(candidate).isFile(); } catch { return false; }
  }) ?? null;
}

test("target-lifecycle stays independent from Premium, React, Supabase and plan UI", () => {
  const violations = [];
  for (const file of sourceFiles(lifecycleRoot)) {
    if (file.endsWith("architecture-boundary.test.mjs")) continue;
    for (const dependency of importsFor(file)) {
      if (/ct-premium|react|supabase|components\/|app\//i.test(dependency)) {
        violations.push(`${path.relative(libRoot, file)} -> ${dependency}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("CT Premium may depend on the universal lifecycle but the reverse edge is absent", () => {
  const premiumEdges = sourceFiles(premiumRoot).flatMap((file) =>
    importsFor(file).filter((dependency) => dependency.includes("target-lifecycle")).map((dependency) => [file, dependency]),
  );
  assert.ok(premiumEdges.length > 0, "expected at least one ct-premium -> target-lifecycle dependency");
  assert.equal(sourceFiles(lifecycleRoot).some((file) => importsFor(file).some((dependency) => dependency.includes("ct-premium"))), false);
});

test("target-lifecycle and ct-premium relative import graph has no cycle", () => {
  const files = [...sourceFiles(lifecycleRoot), ...sourceFiles(premiumRoot)];
  const known = new Set(files);
  const graph = new Map(files.map((file) => [file, importsFor(file)
    .map((dependency) => resolveLocalImport(file, dependency))
    .filter((dependency) => dependency && known.has(dependency))]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (file) => {
    if (visiting.has(file)) throw new Error(`circular_dependency:${path.relative(libRoot, file)}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of files) visit(file);
  assert.equal(visited.size, files.length);
});

test("target availability enablement requires a non-empty explicit account allowlist", () => {
  const source = readFileSync(path.join(lifecycleRoot, "feature-flags.ts"), "utf8");
  assert.match(source, /flags\.accountAllowlist\.length > 0/);
  assert.doesNotMatch(source, /!flags\.accountAllowlist\.length/);
  assert.doesNotMatch(source, /accountAllowlist\.length === 0\s*\?\s*true/);
});
