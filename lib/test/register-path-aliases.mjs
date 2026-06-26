import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

register(
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "path-alias-loader.mjs")).href,
  pathToFileURL(`${projectRoot}/`),
);
