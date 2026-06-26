import assert from "node:assert/strict";
import test from "node:test";
import {
  NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
  NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
  clearNeedsMoreTargetAccountsManual,
  markNeedsMoreTargetAccountsManual,
  reevaluateNeedsMoreTargetAccountsAutomatic,
} from "./needs-more-target-accounts.ts";

type Row = Record<string, unknown>;

function createMockSupabase(input: {
  targets?: Row[];
  actions?: Row[];
  clientId?: string | null;
}) {
  const targets = [...(input.targets ?? [])];
  const actions = [...(input.actions ?? [])];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const auditLogs: Row[] = [];

  const supabase = {
    rpcCalls,
    auditLogs,
    targets,
    actions,
    from(table: string) {
      const api = {
        select() { return api; },
        eq(column: string, value: unknown) {
          api._filters = [...(api._filters ?? []), { column, op: "eq", value }];
          return api;
        },
        in(column: string, values: unknown[]) {
          api._filters = [...(api._filters ?? []), { column, op: "in", value: values }];
          return api;
        },
        order() { return api; },
        limit(count = 500) {
          const filters = [...(api._filters ?? [])];
          const limitValue = count;
          return {
            maybeSingle: async () => {
              const rows = filterRows(table, targets, actions, filters, input.clientId).slice(0, limitValue);
              return { data: rows[0] ?? null, error: null };
            },
            then(onFulfilled: (value: { data: Row[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
              const rows = filterRows(table, targets, actions, filters, input.clientId).slice(0, limitValue);
              return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
            },
          };
        },
        maybeSingle: async () => {
          const rows = filterRows(table, targets, actions, api._filters ?? [], input.clientId);
          return { data: rows[0] ?? null, error: null };
        },
        single: async () => {
          const rows = filterRows(table, targets, actions, api._filters ?? [], input.clientId);
          return { data: rows[0] ?? null, error: null };
        },
        update(values: Row) {
          const updateApi = {
            _filters: [] as Array<{ column: string; op: string; value: unknown }>,
            eq(column: string, value: unknown) {
              updateApi._filters.push({ column, op: "eq", value });
              return updateApi;
            },
            in(column: string, vals: unknown[]) {
              updateApi._filters.push({ column, op: "in", value: vals });
              return updateApi;
            },
            select() {
              return {
                maybeSingle: async () => {
                  const updated = mutateRows(table, targets, actions, updateApi._filters, values);
                  return { data: updated[0] ?? null, error: null };
                },
              };
            },
          };
          return updateApi;
        },
        insert: async (row: Row) => {
          auditLogs.push(row);
          return { error: null };
        },
        _filters: [] as Array<{ column: string; op: string; value: unknown }>,
      };
      return api;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const actionId = `action_${actions.length + 1}`;
      actions.push({
        id: actionId,
        account_id: args.p_account_id,
        action_type: args.p_action_type,
        status: args.p_status,
        metadata: args.p_metadata,
        dedupe_key: args.p_dedupe_key,
      });
      return { data: { id: actionId }, error: null };
    },
  };

  return supabase;
}

function filterRows(
  table: string,
  targets: Row[],
  actions: Row[],
  filters: Array<{ column: string; op: string; value: unknown }>,
  clientId: string | null | undefined,
) {
  const source = table === "ig_targets"
    ? targets
    : table === "account_dashboard_actions"
      ? actions
      : table === "client_instagram_accounts"
        ? [{ account_id: "acct-1", client_id: clientId ?? "client-1" }]
        : [];
  return source.filter((row) => filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
    return true;
  }));
}

function mutateRows(
  table: string,
  targets: Row[],
  actions: Row[],
  filters: Array<{ column: string; op: string; value: unknown }>,
  values: Row,
) {
  const source = table === "account_dashboard_actions" ? actions : targets;
  const updated: Row[] = [];
  for (const row of source) {
    const matches = filters.every((filter) => {
      if (filter.op === "eq") return row[filter.column] === filter.value;
      if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
      return true;
    });
    if (matches) Object.assign(row, values);
    if (matches) updated.push(row);
  }
  return updated;
}

function eligibleTarget(index: number) {
  return {
    account_id: "acct-1",
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
    id: `target-${index}`,
  };
}

test("6 eligible targets do not create a signal", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 6 }, (_, index) => eligibleTarget(index + 1)),
  });
  const result = await reevaluateNeedsMoreTargetAccountsAutomatic(supabase as never, {
    accountId: "acct-1",
    evaluationReason: "test_six_targets",
  });
  assert.equal(result.eligible_target_count, 6);
  assert.equal(result.needs_more_targets, false);
  assert.equal(result.changed, "unchanged");
  assert.equal(supabase.rpcCalls.length, 0);
});

test("5 eligible targets create one automatic signal", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 5 }, (_, index) => eligibleTarget(index + 1)),
  });
  const result = await reevaluateNeedsMoreTargetAccountsAutomatic(supabase as never, {
    accountId: "acct-1",
    evaluationReason: "test_five_targets",
  });
  assert.equal(result.eligible_target_count, 5);
  assert.equal(result.needs_more_targets, true);
  assert.equal(result.changed, "created");
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0].name, "upsert_account_dashboard_action");
  assert.equal(supabase.rpcCalls[0].args.p_action_type, NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE);
  assert.equal(supabase.rpcCalls[0].args.p_blocking_campaign, false);
});

test("repeated automatic reevaluation at 5 targets stays idempotent", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 5 }, (_, index) => eligibleTarget(index + 1)),
    actions: [{
      id: "action-1",
      account_id: "acct-1",
      action_type: NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
      status: "pending",
    }],
  });
  const result = await reevaluateNeedsMoreTargetAccountsAutomatic(supabase as never, {
    accountId: "acct-1",
    evaluationReason: "test_repeat_five",
  });
  assert.equal(result.changed, "idempotent");
  assert.equal(supabase.rpcCalls.length, 1);
});

test("adding a sixth eligible target dismisses the active signal", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 6 }, (_, index) => eligibleTarget(index + 1)),
    actions: [{
      id: "action-1",
      account_id: "acct-1",
      action_type: NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
      status: "pending",
    }],
  });
  const result = await reevaluateNeedsMoreTargetAccountsAutomatic(supabase as never, {
    accountId: "acct-1",
    evaluationReason: "target_restore",
  });
  assert.equal(result.eligible_target_count, 6);
  assert.equal(result.needs_more_targets, false);
  assert.equal(result.changed, "dismissed");
  assert.equal(supabase.actions[0].status, "dismissed");
  assert.equal(supabase.auditLogs.length, 1);
});

test("low FBR archive reevaluation at 5 eligible targets creates signal without changing threshold", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 5 }, (_, index) => eligibleTarget(index + 1)),
  });
  const result = await reevaluateNeedsMoreTargetAccountsAutomatic(supabase as never, {
    accountId: "acct-1",
    evaluationReason: "target_auto_archive_low_fbr",
  });
  assert.equal(result.eligible_target_count, 5);
  assert.equal(result.needs_more_targets, true);
  assert.equal(NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD, 5);
});

test("provider-error style pending target does not count as eligible", async () => {
  const supabase = createMockSupabase({
    targets: [
      ...Array.from({ length: 5 }, (_, index) => eligibleTarget(index + 1)),
      {
        account_id: "acct-1",
        status: "pending_verification",
        quality_status: "unknown",
        verification_status: "provider_error",
        id: "target-pending",
      },
    ],
  });
  const result = await reevaluateNeedsMoreTargetAccountsAutomatic(supabase as never, {
    accountId: "acct-1",
    evaluationReason: "target_verification_terminal",
  });
  assert.equal(result.eligible_target_count, 5);
  assert.equal(result.needs_more_targets, true);
  assert.equal(result.changed, "created");
});

test("manual BotApp mark creates signal and is idempotent when already active", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 13 }, (_, index) => eligibleTarget(index + 1)),
    actions: [{
      id: "action-1",
      account_id: "acct-1",
      action_type: NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
      status: "pending",
    }],
  });
  const result = await markNeedsMoreTargetAccountsManual(supabase as never, {
    accountId: "acct-1",
    actorType: "botapp",
  });
  assert.equal(result.needs_more_targets, true);
  assert.equal(result.changed, "idempotent");
  assert.equal(supabase.rpcCalls[0].args.p_metadata.trigger_source, "manual");
});

test("manual clear dismisses active signal", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 3 }, (_, index) => eligibleTarget(index + 1)),
    actions: [{
      id: "action-1",
      account_id: "acct-1",
      action_type: NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
      status: "pending",
    }],
  });
  const result = await clearNeedsMoreTargetAccountsManual(supabase as never, {
    accountId: "acct-1",
    actorType: "botapp",
  });
  assert.equal(result.changed, "dismissed");
  assert.equal(supabase.actions[0].status, "dismissed");
});
