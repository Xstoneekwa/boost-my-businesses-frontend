import assert from "node:assert/strict";
import test from "node:test";

import {
  reportWelcomeTemplateMissingIncident,
  resolveWelcomeTemplateMissingIncidents,
} from "./schedule-session-configuration-incidents.ts";

function query(data: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data, error: null }),
  };
  return chain;
}

test("welcome_template_missing uses one stable incident dedupe and a linked blocking action", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      if (table === "ig_accounts") return query({ username: "safe_account", client_id: "client-1" });
      return query({ commercial_package_label: "Pro" });
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: name === "upsert_account_incident" ? { id: "incident-1" } : {}, error: null };
    },
  };

  const first = await reportWelcomeTemplateMissingIncident(client as never, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    startsAt: "2026-07-26T16:00:00Z",
    endsAt: "2026-07-26T22:00:00Z",
  });
  const second = await reportWelcomeTemplateMissingIncident(client as never, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    startsAt: "2026-07-26T16:00:00Z",
    endsAt: "2026-07-26T22:00:00Z",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls[0]?.args.p_dedupe_key, calls[2]?.args.p_dedupe_key);
  assert.equal(calls[0]?.args.p_reason, "welcome_template_missing");
  assert.equal(calls[0]?.args.p_incident_type, "account_configuration_failure");
  assert.equal(calls[1]?.args.p_blocking_campaign, true);
  assert.equal(calls[1]?.args.p_incident_id, "incident-1");
  assert.equal(JSON.stringify(calls).includes("password"), false);
});

test("resolution delegates to canonical incident lifecycle RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from: () => query(null),
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: 1, error: null };
    },
  };
  const result = await resolveWelcomeTemplateMissingIncidents(client as never, "account-1");
  assert.deepEqual(result, { ok: true, resolvedCount: 1 });
  assert.equal(calls[0]?.name, "resolve_welcome_template_missing_incidents_v1");
});
