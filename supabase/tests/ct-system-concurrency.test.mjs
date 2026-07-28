import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const databaseUrl = process.env.CT_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CT_TEST_DATABASE_URL is required");

async function sql(statement) {
  const { stdout, stderr } = await runFile("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-Atq", databaseUrl, "-c", `set request.jwt.claim.role='service_role'; ${statement}`], {
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stderr && !stderr.includes("NOTICE:")) throw new Error(stderr);
  return stdout.trim().split("\n").filter((line) => line && line !== "SET").at(-1) ?? "";
}

const accountId = "20000000-0000-0000-0001-000000000001";
const actorId = "20000000-0000-0000-0000-000000000001";
const proposals = `jsonb_build_array(
  jsonb_build_object('username','concurrent_one','displayUsername','concurrent_one','score',99,'eligibilityStatus','eligible'),
  jsonb_build_object('username','concurrent_two','displayUsername','concurrent_two','score',98,'eligibilityStatus','eligible')
)`;

await sql(`select public.ct_create_premium_proposal_batch_v1(
  '${accountId}','${actorId}','concurrency-batch-1','low_stock',
  jsonb_build_object('eligibleTargetCount',5,'activeTargets','[]'::jsonb),${proposals},now()
)`);
const proposalId = await sql(`select id from public.ct_proposals where account_id='${accountId}' and normalized_username='concurrent_one'`);

const decisions = await Promise.all([
  sql(`select public.ct_decide_premium_proposal_v1('${accountId}','${proposalId}','${actorId}','accept','concurrent-decision-a',now())`),
  sql(`select public.ct_decide_premium_proposal_v1('${accountId}','${proposalId}','${actorId}','accept','concurrent-decision-b',now())`),
]);
assert.equal(decisions.filter((result) => JSON.parse(result).changed).length, 1, "one canonical decision");

const activations = await Promise.all([
  sql(`select public.ct_activate_premium_proposal_v1('${accountId}','${proposalId}','${actorId}','concurrent-activation',now())`),
  sql(`select public.ct_activate_premium_proposal_v1('${accountId}','${proposalId}','${actorId}','concurrent-activation',now())`),
]);
assert.equal(activations.filter((result) => JSON.parse(result).activated).length, 1, "one canonical activation");
assert.equal(await sql(`select count(*) from public.ig_targets where account_id='${accountId}' and normalized_username='concurrent_one'`), "1");

const timeoutAccountId = "20000000-0000-0000-0001-000000000002";
await sql(`select public.ct_create_premium_proposal_batch_v1(
  '${timeoutAccountId}','${actorId}','concurrency-timeout-batch','low_stock',
  jsonb_build_object('eligibleTargetCount',5,'activeTargets','[]'::jsonb),${proposals},now()-interval '6 days'
)`);
const claims = await Promise.all([
  sql(`select public.ct_claim_expired_premium_batch_v1('claim-worker-a',now())`),
  sql(`select public.ct_claim_expired_premium_batch_v1('claim-worker-b',now())`),
]);
assert.equal(claims.filter((result) => JSON.parse(result).claimed).length, 1, "one canonical timeout claim");

console.log("CT_SYSTEM_CONCURRENCY_CERTIFIED");
