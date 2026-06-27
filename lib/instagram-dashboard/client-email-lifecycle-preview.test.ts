import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadClientEmailLifecyclePreview } from "./client-email-lifecycle-preview.ts";

const previewRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-lifecycle/preview/route.ts", import.meta.url),
  "utf8",
);

const baseAccountId = "acct-life-1";
const baseClientId = "client-life-1";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function createMockSupabase(input: {
  lifecycleByAccount?: Map<string, string>;
  transitionLogs?: Array<{ account_id: string; message: string; created_at: string }>;
  episodeRows?: Array<Record<string, unknown>>;
  clientMetadata?: Record<string, unknown>;
  schemaReady?: boolean;
  env?: Record<string, string | undefined>;
} = {}) {
  const lifecycleByAccount = input.lifecycleByAccount ?? new Map([[baseAccountId, "paused"]]);
  const transitionLogs = input.transitionLogs ?? [];
  const episodeRows = input.episodeRows ?? [];
  const schemaReady = input.schemaReady !== false;
  const writes: Array<{ table: string; op: string }> = [];

  function runSelect(table: string, columns: string, filters: Record<string, unknown>) {
    if (table === "client_email_lifecycle_episodes" && columns === "id,category,status") {
      if (!schemaReady) {
        return {
          data: null,
          error: {
            message: "Could not find the table 'public.client_email_lifecycle_episodes' in the schema cache",
            code: "PGRST205",
          },
        };
      }
      return { data: [], error: null };
    }

    if (table === "ig_accounts" && columns === "id,admin_lifecycle_status") {
      const statuses = (filters.admin_lifecycle_status_in as string[] | undefined) ?? [];
      const rows = [...lifecycleByAccount.entries()]
        .filter(([, status]) => statuses.includes(status))
        .map(([id, admin_lifecycle_status]) => ({ id, admin_lifecycle_status }));
      return { data: rows, error: null };
    }

    if (table === "ig_accounts" && columns === "id,username") {
      const accountFilter = filters.id_in as string[] | undefined;
      return {
        data: (accountFilter ?? []).map((id) => ({ id, username: "paused_user" })),
        error: null,
      };
    }

    if (table === "client_instagram_accounts") {
      const accountFilter = filters.account_id_in as string[] | undefined;
      return {
        data: (accountFilter ?? []).map((accountId) => ({
          account_id: accountId,
          client_id: baseClientId,
        })),
        error: null,
      };
    }

    if (table === "clients") {
      return {
        data: [{
          id: baseClientId,
          name: "Lifecycle Client",
          metadata: input.clientMetadata ?? { contact_email: "client@example.com" },
        }],
        error: null,
      };
    }

    if (table === "client_email_lifecycle_episodes") {
      if (filters.status === "active" && columns === "account_id") {
        return {
          data: episodeRows
            .filter((row) => readString(row.status, "") === "active")
            .map((row) => ({ account_id: row.account_id })),
          error: null,
        };
      }
      if (filters.status === "active") {
        const accountFilter = filters.account_id_in as string[] | undefined;
        return {
          data: episodeRows.filter((row) => {
            if (readString(row.status, "") !== "active") return false;
            if (!accountFilter?.length) return true;
            return accountFilter.includes(readString(row.account_id, ""));
          }),
          error: null,
        };
      }
    }

    if (table === "ig_action_logs") {
      const accountFilter = filters.account_id_in as string[] | undefined;
      const messageFilter = filters.message_in as string[] | undefined;
      const rows = transitionLogs.filter((row) => {
        if (accountFilter && !accountFilter.includes(row.account_id)) return false;
        if (messageFilter && !messageFilter.includes(row.message)) return false;
        return true;
      });
      return { data: rows, error: null };
    }

    return { data: [], error: null };
  }

  function makeSelectBuilder(table: string, columns: string) {
    const filters: Record<string, unknown> = {};
    let single = false;

    function execute() {
      const result = runSelect(table, columns, filters);
      if (single) {
        return Promise.resolve({ data: result.data ?? null, error: result.error });
      }
      return Promise.resolve({
        data: Array.isArray(result.data) ? result.data : result.data ? [result.data] : [],
        error: result.error,
      });
    }

    const builder = {
      eq(field: string, value: unknown) {
        filters[field] = value;
        return builder;
      },
      in(field: string, values: unknown[]) {
        filters[`${field}_in`] = values;
        return builder;
      },
      order() {
        return builder;
      },
      limit(_count?: number) {
        return {
          maybeSingle() {
            single = true;
            return execute();
          },
          then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
            return execute().then(onFulfilled, onRejected);
          },
        };
      },
      maybeSingle() {
        single = true;
        return execute();
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return execute().then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  return {
    writes,
    from(table: string) {
      return {
        select(columns: string) {
          return makeSelectBuilder(table, columns);
        },
        insert: () => {
          writes.push({ table, op: "insert" });
          return Promise.resolve({ data: null, error: null });
        },
        update: () => {
          writes.push({ table, op: "update" });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        delete: () => {
          writes.push({ table, op: "delete" });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

test("lifecycle preview route requires relay or admin auth", () => {
  assert.match(previewRoute, /requireRelayOrAdmin/);
  assert.match(previewRoute, /Cache-Control.*no-store/);
  assert.doesNotMatch(previewRoute, /requireClientInstagramSession/);
  assert.doesNotMatch(previewRoute, /POSTMARK/);
});

test("lifecycle preview route is read-only", () => {
  assert.match(previewRoute, /loadClientEmailLifecyclePreview/);
  assert.doesNotMatch(previewRoute, /\.insert\(/);
  assert.doesNotMatch(previewRoute, /\.update\(/);
});

test("historical paused account previews legacy_state_no_backfill", async () => {
  const supabase = createMockSupabase({
    transitionLogs: [{
      account_id: baseAccountId,
      message: "account_paused",
      created_at: "2026-06-01T12:00:00.000Z",
    }],
  });
  const preview = await loadClientEmailLifecyclePreview(supabase as never, { env: {} });
  assert.equal(preview.items[0]?.lifecycleDecision, "legacy_state_no_backfill");
  assert.equal(preview.mutationExecuted, false);
  assert.equal(supabase.writes.length, 0);
});

test("post-watermark transition previews would_open_episode_on_future_transition", async () => {
  const supabase = createMockSupabase({
    transitionLogs: [{
      account_id: baseAccountId,
      message: "account_paused",
      created_at: "2026-07-02T09:00:00.000Z",
    }],
  });
  const preview = await loadClientEmailLifecyclePreview(supabase as never, {
    env: { CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z" },
  });
  assert.equal(preview.items[0]?.lifecycleDecision, "would_open_episode_on_future_transition");
});

test("active episode with cleared lifecycle previews would_resolve_episode", async () => {
  const supabase = createMockSupabase({
    lifecycleByAccount: new Map([[baseAccountId, "active"]]),
    episodeRows: [{
      account_id: baseAccountId,
      category: "account_paused",
      status: "active",
      started_at: "2026-07-02T09:00:00.000Z",
    }],
    transitionLogs: [{
      account_id: baseAccountId,
      message: "account_paused",
      created_at: "2026-07-02T09:00:00.000Z",
    }],
  });
  const preview = await loadClientEmailLifecyclePreview(supabase as never, {
    env: { CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z" },
  });
  assert.equal(preview.items[0]?.lifecycleDecision, "would_resolve_episode");
});

test("missing client email keeps lifecycle decision separate from delivery block", async () => {
  const supabase = createMockSupabase({
    clientMetadata: {},
    transitionLogs: [{
      account_id: baseAccountId,
      message: "account_paused",
      created_at: "2026-07-02T09:00:00.000Z",
    }],
  });
  const preview = await loadClientEmailLifecyclePreview(supabase as never, {
    env: { CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT: "2026-07-01T00:00:00.000Z" },
  });
  assert.equal(preview.items[0]?.lifecycleDecision, "would_open_episode_on_future_transition");
  assert.equal(preview.items[0]?.deliveryState, "blocked_missing_client_email");
});

test("preview performs zero lifecycle or email writes", async () => {
  const supabase = createMockSupabase();
  await loadClientEmailLifecyclePreview(supabase as never);
  assert.equal(supabase.writes.length, 0);
});
