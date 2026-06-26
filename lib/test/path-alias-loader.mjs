import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveAlias(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const relativePath = specifier.slice(2);
  const candidates = [
    relativePath,
    `${relativePath}.ts`,
    `${relativePath}.tsx`,
    `${relativePath}.mts`,
    join(relativePath, "index.ts"),
  ];
  for (const candidate of candidates) {
    const absolute = join(projectRoot, candidate);
    if (existsSync(absolute)) {
      return pathToFileURL(absolute).href;
    }
  }
  return pathToFileURL(join(projectRoot, relativePath)).href;
}

export async function resolve(specifier, context, nextResolve) {
  const aliased = resolveAlias(specifier);
  if (aliased) {
    return nextResolve(aliased, context);
  }
  return nextResolve(specifier, context);
}
