import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClientNotificationKey,
  deriveClientNotificationDesiredStates,
  loadClientAccountNotificationsForClient,
  markClientAccountNotificationRead,
  reconcileClientAccountNotificationsForAccount,
  reconcileClientAccountNotificationsForClient,
} from "./client-account-notifications.ts";
import {
  isClientAccountNotificationsTableMissingError,
  probeClientAccountNotificationsTable,
} from "./client-account-notifications-schema-guard.ts";

const MISSING_TABLE_ERROR = {
  message: "Could not find the table 'public.client_account_notifications' in the schema cache",
  code: "PGRST205",
};

type Row = Record<string, unknown>;

function createMockSupabase(input: {
  clientId?: string;
  accounts?: Row[];
  links?: Row[];
  targets?: Row[];
  actions?: Row[];
  notifications?: Row[];
  notificationsTableMissing?: boolean;
  notificationsTableError?: { message: string; code?: string };
}) {
  const clientId = input.clientId ?? "client-1";
  const links = [...(input.links ?? [{ client_id: clientId, account_id: "acct-1" }])];
  const accounts = [...(input.accounts ?? [{
    id: "acct-1",
    username: "xstonekwa_backup_acc",
    admin_lifecycle_status: "active",
    status: "active",
  }])];
  const targets = [...(input.targets ?? Array.from({ length: 6 }, (_, index) => ({
    account_id: "acct-1",
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
    id: `default-target-${index}`,
  })))];
  const actions = [...(input.actions ?? [])];
  const notifications = [...(input.notifications ?? [])];
  const notificationsTableMissing = input.notificationsTableMissing === true;
  const notificationsTableError = input.notificationsTableError ?? MISSING_TABLE_ERROR;

  function filterRows(table: string, filters: Array<{ column: string; op: string; value: unknown }>) {
    const source = table === "client_instagram_accounts" ? links
      : table === "ig_accounts" ? accounts
        : table === "ig_targets" ? targets
          : table === "account_dashboard_actions" ? actions
            : table === "client_account_notifications" ? notifications
              : [];
    return source.filter((row) => filters.every((filter) => {
      if (filter.op === "eq") return row[filter.column] === filter.value;
      if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
      return true;
    }));
  }

  function makeQuery(table: string) {
    const state = { filters: [] as Array<{ column: string; op: string; value: unknown }>, updateValues: null as Row | null };
    const missingTableResponse = () => ({
      data: null,
      error: notificationsTableError,
    });
    const api = {
      select() { return api; },
      eq(column: string, value: unknown) {
        state.filters.push({ column, op: "eq", value });
        return api;
      },
      in(column: string, value: unknown[]) {
        state.filters.push({ column, op: "in", value });
        return api;
      },
      order() { return api; },
      limit(count = 100) {
        const limitValue = count;
        if (table === "client_account_notifications" && notificationsTableMissing) {
          return Promise.resolve(missingTableResponse());
        }
        return {
          maybeSingle: async () => {
            if (table === "client_account_notifications" && notificationsTableMissing) {
              return missingTableResponse();
            }
            const rows = filterRows(table, state.filters).slice(0, limitValue);
            if (state.updateValues) {
              for (const row of rows) Object.assign(row, state.updateValues);
            }
            return { data: rows[0] ?? null, error: null };
          },
          then(onFulfilled: (value: { data: Row[] | null; error: { message?: string; code?: string } | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
            if (table === "client_account_notifications" && notificationsTableMissing) {
              return Promise.resolve(missingTableResponse()).then(onFulfilled, onRejected);
            }
            const rows = filterRows(table, state.filters).slice(0, limitValue);
            return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
          },
        };
      },
      maybeSingle: async () => {
        if (table === "client_account_notifications" && notificationsTableMissing) {
          return missingTableResponse();
        }
        const rows = filterRows(table, state.filters);
        if (state.updateValues) {
          for (const row of rows) Object.assign(row, state.updateValues);
        }
        return { data: rows[0] ?? null, error: null };
      },
      update(values: Row) {
        state.updateValues = values;
        return api;
      },
      insert: (values: Row | Row[]) => {
        if (table === "client_account_notifications" && notificationsTableMissing) {
          return {
            select: () => ({
              maybeSingle: async () => missingTableResponse(),
            }),
          };
        }
        const rows = Array.isArray(values) ? values : [values];
        const inserted: Row[] = [];
        for (const row of rows) {
          const next = {
            id: `notif-${notifications.length + 1}`,
            created_at: new Date().toISOString(),
            read_at: null,
            resolved_at: null,
            status: "active",
            ...row,
          };
          notifications.push(next);
          inserted.push(next);
        }
        const chain = {
          select: () => chain,
          maybeSingle: async () => ({ data: inserted[0] ?? null, error: null }),
        };
        return chain;
      },
      then(
        onFulfilled?: (value: { data: Row[] | null; error: { message?: string; code?: string } | null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        if (table === "client_account_notifications" && notificationsTableMissing) {
          return Promise.resolve(missingTableResponse()).then(onFulfilled, onRejected);
        }
        const rows = filterRows(table, state.filters);
        if (state.updateValues) {
          for (const row of rows) Object.assign(row, state.updateValues);
        }
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return {
    clientId,
    notifications,
    accounts,
    links,
    from: makeQuery,
  };
}

test("needs_more_target_accounts creates one active client notification with username and CTA", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 5 }, (_, index) => ({
      account_id: "acct-1",
      status: "valid",
      quality_status: "eligible",
      verification_status: "found",
      id: `target-${index}`,
    })),
    actions: [{ account_id: "acct-1", action_type: "needs_more_target_accounts", status: "pending", id: "action-1" }],
  });

  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  const projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.featureAvailable, true);
  assert.equal(projection.active.length, 1);
  assert.equal(projection.active[0].category, "needs_more_target_accounts");
  assert.match(projection.active[0].message, /xstonekwa_backup_acc/);
  assert.equal(projection.active[0].ctaHref, "/instagram-client?view=targeting");
});

test("marking needs_more_target_accounts notification as read does not resolve it", async () => {
  const supabase = createMockSupabase({
    notifications: [{
      id: "notif-1",
      client_id: "client-1",
      account_id: "acct-1",
      category: "needs_more_target_accounts",
      status: "active",
      notification_key: buildClientNotificationKey("client-1", "acct-1", "needs_more_target_accounts"),
      metadata_safe: { username: "xstonekwa_backup_acc", eligible_target_count: 4, threshold: 5 },
      created_at: "2026-06-20T10:00:00.000Z",
      read_at: null,
      resolved_at: null,
    }],
  });

  const result = await markClientAccountNotificationRead(supabase, {
    clientId: "client-1",
    notificationId: "notif-1",
  });
  assert.equal(result.ok, true);
  assert.ok(result.notification?.readAt);
  assert.equal(supabase.notifications[0].status, "active");
});

test("adding eligible targets resolves needs_more_target_accounts and keeps history", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 6 }, (_, index) => ({
      account_id: "acct-1",
      status: "valid",
      quality_status: "eligible",
      verification_status: "found",
      id: `target-${index}`,
    })),
    actions: [],
    notifications: [{
      id: "notif-1",
      client_id: "client-1",
      account_id: "acct-1",
      category: "needs_more_target_accounts",
      status: "active",
      notification_key: buildClientNotificationKey("client-1", "acct-1", "needs_more_target_accounts"),
      metadata_safe: { username: "xstonekwa_backup_acc", eligible_target_count: 4, threshold: 5 },
      created_at: "2026-06-20T10:00:00.000Z",
      read_at: null,
      resolved_at: null,
    }],
  });

  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  const projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active.length, 0);
  assert.equal(projection.activeCount, 0);
  assert.equal(projection.recentResolved.length, 1);
  assert.equal(projection.unreadActiveCount, 0);
});

test("needs_assistance stays active after read and resolves only when lifecycle clears", async () => {
  const supabase = createMockSupabase({
    accounts: [{ id: "acct-1", username: "acct_help", admin_lifecycle_status: "needs_assistance", status: "active" }],
  });
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  const activeId = supabase.notifications[0].id as string;
  await markClientAccountNotificationRead(supabase, { clientId: "client-1", notificationId: activeId });
  let projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active.length, 1);

  supabase.accounts[0].admin_lifecycle_status = "active";
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active.length, 0);
  assert.equal(projection.recentResolved.length, 1);
});

test("pause then reactivate creates and resolves account_paused notification", async () => {
  const supabase = createMockSupabase({});
  supabase.accounts[0].admin_lifecycle_status = "paused";
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  let projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active[0]?.category, "account_paused");

  supabase.accounts[0].admin_lifecycle_status = "active";
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active.length, 0);
  assert.equal(projection.recentResolved[0]?.category, "account_paused");
});

test("canceled notification remains active after read and cannot be dismissed by read", async () => {
  const supabase = createMockSupabase({
    accounts: [{ id: "acct-1", username: "canceled_user", admin_lifecycle_status: "cancelled", status: "active" }],
  });
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  const activeId = supabase.notifications[0].id as string;
  await markClientAccountNotificationRead(supabase, { clientId: "client-1", notificationId: activeId });
  const projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active.length, 1);
  assert.equal(projection.active[0].category, "account_canceled");
  assert.ok(projection.active[0].readAt);
});

test("two accounts for the same client keep notifications attached to the right username", async () => {
  const supabase = createMockSupabase({
    links: [
      { client_id: "client-1", account_id: "acct-1" },
      { client_id: "client-1", account_id: "acct-2" },
    ],
    accounts: [
      { id: "acct-1", username: "alpha_user", admin_lifecycle_status: "paused", status: "active" },
      { id: "acct-2", username: "beta_user", admin_lifecycle_status: "cancelled", status: "active" },
    ],
    targets: [
      ...Array.from({ length: 6 }, (_, index) => ({
        account_id: "acct-1",
        status: "valid",
        quality_status: "eligible",
        verification_status: "found",
        id: `acct-1-target-${index}`,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        account_id: "acct-2",
        status: "valid",
        quality_status: "eligible",
        verification_status: "found",
        id: `acct-2-target-${index}`,
      })),
    ],
  });
  await reconcileClientAccountNotificationsForClient(supabase, "client-1");
  const projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active.length, 2);
  assert.deepEqual(
    projection.active.map((row) => `${row.username}:${row.category}`).sort(),
    ["alpha_user:account_paused", "beta_user:account_canceled"].sort(),
  );
});

test("multi-tenant isolation keeps notifications scoped to the requesting client", async () => {
  const supabase = createMockSupabase({
    clientId: "client-1",
    notifications: [
      {
        id: "notif-1",
        client_id: "client-1",
        account_id: "acct-1",
        category: "account_paused",
        status: "active",
        notification_key: buildClientNotificationKey("client-1", "acct-1", "account_paused"),
        metadata_safe: { username: "alpha_user" },
        created_at: "2026-06-20T10:00:00.000Z",
      },
      {
        id: "notif-2",
        client_id: "client-2",
        account_id: "acct-9",
        category: "account_canceled",
        status: "active",
        notification_key: buildClientNotificationKey("client-2", "acct-9", "account_canceled"),
        metadata_safe: { username: "other_client" },
        created_at: "2026-06-20T10:00:00.000Z",
      },
    ],
  });

  const projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.active.length, 1);
  assert.equal(projection.active[0].username, "alpha_user");
});

test("repeated reconciliations remain idempotent for the same active category", async () => {
  const supabase = createMockSupabase({
    accounts: [{ id: "acct-1", username: "acct_help", admin_lifecycle_status: "needs_assistance", status: "active" }],
  });
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  const active = supabase.notifications.filter((row) => row.status === "active" && row.category === "needs_assistance");
  assert.equal(active.length, 1);
});

test("deriveClientNotificationDesiredStates mirrors canonical lifecycle and target count", async () => {
  const supabase = createMockSupabase({
    targets: Array.from({ length: 4 }, (_, index) => ({
      account_id: "acct-1",
      status: "valid",
      quality_status: "eligible",
      verification_status: "found",
      id: `target-${index}`,
    })),
    actions: [{ account_id: "acct-1", action_type: "needs_more_target_accounts", status: "pending", id: "action-1" }],
    accounts: [{ id: "acct-1", username: "acct_help", admin_lifecycle_status: "paused", status: "active" }],
  });
  const states = await deriveClientNotificationDesiredStates(supabase, {
    accountId: "acct-1",
    username: "acct_help",
    lifecycleStatus: "paused",
  });
  const byCategory = Object.fromEntries(states.map((state) => [state.category, state.active]));
  assert.equal(byCategory.needs_more_target_accounts, true);
  assert.equal(byCategory.needs_assistance, false);
  assert.equal(byCategory.account_paused, true);
  assert.equal(byCategory.account_canceled, false);
});

test("active notification marked as read stays active and keeps active badge count", async () => {
  const supabase = createMockSupabase({
    notifications: [{
      id: "notif-1",
      client_id: "client-1",
      account_id: "acct-1",
      category: "account_paused",
      status: "active",
      notification_key: buildClientNotificationKey("client-1", "acct-1", "account_paused"),
      metadata_safe: { username: "alpha_user" },
      created_at: "2026-06-20T10:00:00.000Z",
      read_at: null,
      resolved_at: null,
    }],
  });
  const before = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(before.activeCount, 1);
  assert.equal(before.unreadActiveCount, 1);

  await markClientAccountNotificationRead(supabase, { clientId: "client-1", notificationId: "notif-1" });
  const after = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(after.active.length, 1);
  assert.equal(after.activeCount, 1);
  assert.equal(after.unreadActiveCount, 0);
  assert.ok(after.active[0].readAt);
  assert.equal(after.recentResolved.length, 0);
});

test("resolved notification leaves active badge and appears only in resolved history", async () => {
  const supabase = createMockSupabase({
    notifications: [{
      id: "notif-1",
      client_id: "client-1",
      account_id: "acct-1",
      category: "account_paused",
      status: "active",
      notification_key: buildClientNotificationKey("client-1", "acct-1", "account_paused"),
      metadata_safe: { username: "alpha_user" },
      created_at: "2026-06-20T10:00:00.000Z",
      read_at: "2026-06-20T11:00:00.000Z",
      resolved_at: null,
    }],
  });
  const before = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(before.activeCount, 1);

  supabase.accounts[0].admin_lifecycle_status = "active";
  await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  const after = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(after.active.length, 0);
  assert.equal(after.activeCount, 0);
  assert.equal(after.recentResolved.length, 1);
  assert.equal(after.recentResolved[0].status, "resolved");
});

test("active badge counts all active notifications regardless of read state", async () => {
  const supabase = createMockSupabase({
    links: [
      { client_id: "client-1", account_id: "acct-1" },
      { client_id: "client-1", account_id: "acct-2" },
    ],
    accounts: [
      { id: "acct-1", username: "alpha_user", admin_lifecycle_status: "paused", status: "active" },
      { id: "acct-2", username: "beta_user", admin_lifecycle_status: "cancelled", status: "active" },
    ],
    targets: [
      ...Array.from({ length: 6 }, (_, index) => ({
        account_id: "acct-1",
        status: "valid",
        quality_status: "eligible",
        verification_status: "found",
        id: `acct-1-target-${index}`,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        account_id: "acct-2",
        status: "valid",
        quality_status: "eligible",
        verification_status: "found",
        id: `acct-2-target-${index}`,
      })),
    ],
    notifications: [
      {
        id: "notif-1",
        client_id: "client-1",
        account_id: "acct-1",
        category: "account_paused",
        status: "active",
        notification_key: buildClientNotificationKey("client-1", "acct-1", "account_paused"),
        metadata_safe: { username: "alpha_user" },
        created_at: "2026-06-20T10:00:00.000Z",
        read_at: "2026-06-20T11:00:00.000Z",
        resolved_at: null,
      },
      {
        id: "notif-2",
        client_id: "client-1",
        account_id: "acct-2",
        category: "account_canceled",
        status: "active",
        notification_key: buildClientNotificationKey("client-1", "acct-2", "account_canceled"),
        metadata_safe: { username: "beta_user" },
        created_at: "2026-06-20T10:00:00.000Z",
        read_at: null,
        resolved_at: null,
      },
    ],
  });

  const projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.activeCount, 2);
  assert.equal(projection.active.length, 2);
  assert.equal(projection.unreadActiveCount, 1);
});

test("missing notifications table returns neutral projection without writes", async () => {
  const supabase = createMockSupabase({
    notificationsTableMissing: true,
    accounts: [{ id: "acct-1", username: "acct_help", admin_lifecycle_status: "needs_assistance", status: "active" }],
  });

  const reconcileResult = await reconcileClientAccountNotificationsForAccount(supabase, "acct-1");
  assert.deepEqual(reconcileResult.changed, []);
  assert.equal(supabase.notifications.length, 0);

  const projection = await loadClientAccountNotificationsForClient(supabase, "client-1");
  assert.equal(projection.featureAvailable, false);
  assert.deepEqual(projection, {
    featureAvailable: false,
    active: [],
    recentResolved: [],
    activeCount: 0,
    unreadActiveCount: 0,
  });
});

test("missing notifications table keeps mark-read as strict no-op", async () => {
  const supabase = createMockSupabase({ notificationsTableMissing: true });
  const result = await markClientAccountNotificationRead(supabase, {
    clientId: "client-1",
    notificationId: "notif-1",
  });
  assert.deepEqual(result, { ok: false, reason: "feature_unavailable" });
  assert.equal(supabase.notifications.length, 0);
});

test("missing notifications table client reconcile is strict no-op", async () => {
  const supabase = createMockSupabase({
    notificationsTableMissing: true,
    accounts: [{ id: "acct-1", username: "acct_help", admin_lifecycle_status: "paused", status: "active" }],
  });
  const result = await reconcileClientAccountNotificationsForClient(supabase, "client-1");
  assert.deepEqual(result.accounts, []);
  assert.equal(supabase.notifications.length, 0);
});

test("unrelated notifications table errors are not swallowed", async () => {
  const supabase = createMockSupabase({
    notificationsTableError: {
      message: "permission denied for table client_account_notifications",
      code: "42501",
    },
    notificationsTableMissing: true,
  });

  await assert.rejects(
    () => loadClientAccountNotificationsForClient(supabase, "client-1"),
    /permission denied for table client_account_notifications/,
  );
});

test("schema guard recognizes postgrest cache miss and postgres undefined table", () => {
  assert.equal(
    isClientAccountNotificationsTableMissingError(MISSING_TABLE_ERROR),
    true,
  );
  assert.equal(
    isClientAccountNotificationsTableMissingError({
      message: 'relation "public.client_account_notifications" does not exist',
      code: "42P01",
    }),
    true,
  );
  assert.equal(
    isClientAccountNotificationsTableMissingError({ message: "connection timeout" }),
    false,
  );
  assert.equal(
    isClientAccountNotificationsTableMissingError({
      message: "permission denied for table client_account_notifications",
      code: "42501",
    }),
    false,
  );
});

test("probe reports unavailable only for missing notifications table", async () => {
  const missing = createMockSupabase({ notificationsTableMissing: true });
  assert.deepEqual(await probeClientAccountNotificationsTable(missing), { available: false });

  const present = createMockSupabase({});
  assert.deepEqual(await probeClientAccountNotificationsTable(present), { available: true });
});
