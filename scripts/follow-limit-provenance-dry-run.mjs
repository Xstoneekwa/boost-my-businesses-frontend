#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { classifyFollowLimitReconciliation } from "../lib/instagram-dashboard/follow-limit-reconciliation.ts";

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Usage: node scripts/follow-limit-provenance-dry-run.mjs <read-only-snapshot.json>\n");
  process.exitCode = 2;
} else {
  const raw = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array.");
  const rows = raw.map(classifyFollowLimitReconciliation);
  process.stdout.write(`${JSON.stringify({ mode: "read_only", rows }, null, 2)}\n`);
}
