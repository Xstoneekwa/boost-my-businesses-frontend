import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const databaseUrl = process.env.FOLLOW_LIMIT_POSTGRES_URL?.trim();
const root = fileURLToPath(new URL("..", import.meta.url));

function psql(args, options = {}) {
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", ...args], {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function concurrentSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-X", "-c", sql], { cwd: root });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

test("candidate migration passes real PostgreSQL constraints, ACL, CRUD, concurrency, and server read", { skip: !databaseUrl }, async () => {
  psql(["-f", "tests/postgres/follow-limit-provenance-bootstrap.sql"]);
  psql(["-f", "supabase/migrations/20260722012822_follow_limit_provenance_v1.sql"]);
  psql(["-f", "tests/postgres/follow-limit-provenance-assertions.sql"]);

  const account = "00000000-0000-0000-0000-000000000002";
  await Promise.all([
    concurrentSql(`select public.save_account_follow_limit_override_v1('${account}', 35, null, 'admin', 'concurrency_a', null, 'a', 'concurrency-a')`),
    concurrentSql(`select public.save_account_follow_limit_override_v1('${account}', 45, 25, 'admin', 'concurrency_b', null, 'b', 'concurrency-b')`),
  ]);
  const auditCount = psql(["-Atc", `select count(*) from public.ig_action_logs where account_id='${account}' and action_type in ('follow_limit_override_created','follow_limit_override_updated')`]).trim();
  assert.equal(auditCount, "2");
  const rowCount = psql(["-Atc", `set role service_role; select count(*) from public.ig_account_follow_limit_overrides where account_id='${account}'; reset role;`]).trim().split("\n").find((line) => /^\d+$/.test(line));
  assert.equal(rowCount, "1");
});
