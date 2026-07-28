import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const manifest = JSON.parse(await readFile(new URL("../baseline/manifest.json", import.meta.url), "utf8"));
const migrations = (await readdir(new URL("../migrations", import.meta.url)))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .map((name) => ({ name, version: name.split("_",1)[0] }))
  .sort((a,b) => a.version.localeCompare(b.version));

const postCutover = migrations.filter(({ version }) => version > manifest.cutoverId);
assert.equal(new Set(postCutover.map(({ version }) => version)).size, postCutover.length, "post-cutover migration versions are unique");
assert.deepEqual(postCutover.map(({ name }) => name), manifest.postCutoverMigrations);
assert.equal(manifest.productionExisting.bootstrapPending, 0);
assert.equal(manifest.productionExisting.unexpectedHistoricalMigrationsPending, 0);
assert.equal(path.basename(manifest.bootstrapFile), "20260728001632_public_schema.sql");
console.log("CT_DATABASE_NON_REPLAY_CERTIFIED");
