import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const section = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);

test("readiness-only result remains authoritative before an enqueue correlation exists", () => {
  const readinessBranch = section.slice(
    section.indexOf("const pending = operationPendingFromReadinessResult"),
    section.indexOf("} catch {", section.indexOf("const pending = operationPendingFromReadinessResult")),
  );
  assert.doesNotMatch(readinessBranch, /syncConnectProgress/);
  assert.match(readinessBranch, /connectProgress: null/);
});

test("post-enqueue progress is loaded only with the returned operation token", () => {
  const connectBranch = section.slice(
    section.indexOf('if (mode === "connect") {', section.indexOf("async function runConnectProcess")),
    section.indexOf("const pending = operationPendingFromReadinessResult"),
  );
  assert.match(connectBranch, /if \(connectOperationToken\)/);
  assert.match(connectBranch, /syncConnectProgress\(account\.accountId, connectOperationToken\)/);
  assert.doesNotMatch(connectBranch, /syncConnectProgress\(account\.accountId, connectOperationToken \|\| null\)/);
});
