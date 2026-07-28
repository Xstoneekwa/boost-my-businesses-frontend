import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specialPattern = /\/(route|page|layout|default)\.(?:ts|tsx)$/;
const commonAllowed = [
  "config",
  "generateStaticParams",
  "unstable_instant",
  "unstable_dynamicStaleTime",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "preferredRegion",
  "runtime",
  "maxDuration",
];
const allowedByKind = {
  route: new Set([...commonAllowed, "GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"]),
  page: new Set([...commonAllowed, "default", "metadata", "generateMetadata", "viewport", "generateViewport"]),
  layout: new Set([...commonAllowed, "default", "metadata", "generateMetadata", "viewport", "generateViewport"]),
  default: new Set([...commonAllowed, "default"]),
};

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function exportedRuntimeNames(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names = [];
  const isExported = (node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) names.push("default");
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause) names.push("*");
      else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly) names.push(element.name.text);
        }
      }
      continue;
    }
    if (!isExported(statement)) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.push("default");
    else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    }
  }
  return names;
}

test("Next.js special modules expose only supported runtime fields", () => {
  const invalid = [];
  const files = walk(path.join(projectRoot, "app")).filter((file) => specialPattern.test(file));
  for (const file of files) {
    const kind = path.basename(file).split(".")[0];
    const allowed = allowedByKind[kind];
    for (const name of exportedRuntimeNames(file)) {
      if (!allowed.has(name)) invalid.push(`${path.relative(projectRoot, file)}: ${name}`);
    }
  }
  assert.deepEqual(invalid, []);
});
