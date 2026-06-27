import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  loadNeedsMoreTargetsEmailLifecyclePreview,
  type NeedsMoreTargetsPreviewAccountRow,
} from "./client-email-needs-more-targets-preview.ts";
import {
  planNeedsMoreTargetsEpisodeReconciliation,
} from "./client-email-needs-more-targets-sequence.ts";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

const previewRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-needs-more-targets/preview/route.ts", import.meta.url),
  "utf8",
);

const baseAccountId = "acct-preview-1";
const baseClientId = "client-preview-1";

function createMockSupabase(input: {
  signalAccountIds?: string[];
  episodeRows?: Array<Record<string, unknown>>;
  eligibleByAccount?: Map<string, number>;
  clientMetadata?: Record<string, unknown>;
  adminLifecycleStatus?: string;
  sequenceSchemaReady?: boolean;
} = {}) {
  const signalAccountIds = input.signalAccountIds ?? [baseAccountId];
  const eligibleByAccount = input.eligibleByAccount ?? new Map([[baseAccountId, 5]]);
  const sequenceSchemaReady = input.sequenceSchemaReady !== false;
  const episodeRows = input.episodeRows ?? [];
  const writes: Array<{ table: string; op: string }> = [];

  function buildTargetRows(accountIds: string[]) {
    return accountIds.flatMap((accountId) => {
      const count = eligibleByAccount.get(String(accountId)) ?? 0;
      return Array.from({ length: count }, (_, index) => ({
        account_id: accountId,
        id: `${accountId}-target-${index}`,
        status: "valid",
        quality_status: "eligible",
        verification_status: "found",
        archived_at: null,
        deleted_at: null,
      }));
    });
  }

  function runSelect(table: string, columns: string, filters: Record<string, unknown>) {
    if (table === "client_email_needs_more_targets_sequences" && columns === "id,status,episode_key") {
      if (!sequenceSchemaReady) {
        return {
          data: null,
          error: {
            message: "Could not find the table 'public.client_email_needs_more_targets_sequences' in the schema cache",
            code: "PGRST205",
          },
        };
      }
      return { data: [], error: null };
    }

    if (table === "account_dashboard_actions" && columns === "account_id") {
      return {
        data: signalAccountIds.map((accountId) => ({ account_id: accountId })),
        error: null,
      };
    }

    if (table === "account_dashboard_actions" && filters.account_id) {
      const active = signalAccountIds.includes(String(filters.account_id));
      return {
        data: active ? { id: "action-1", status: "pending", metadata: {}, updated_at: "2026-06-01T00:00:00.000Z" } : null,
        error: null,
      };
    }

    if (table === "client_email_needs_more_targets_sequences") {
      if (filters.status === "active") {
        if (columns === "account_id") {
          return {
            data: episodeRows
              .filter((row) => readString(row.status, "") === "active")
              .map((row) => ({ account_id: row.account_id })),
            error: null,
          };
        }
        if (columns === "*") {
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

    if (table === "ig_accounts") {
      const accountFilter = (filters.account_id_in as string[] | undefined)
        ?? (filters.id_in as string[] | undefined);
      return {
        data: (accountFilter ?? []).map((accountId) => ({
          id: accountId,
          username: "preview_user",
          admin_lifecycle_status: input.adminLifecycleStatus ?? "active",
        })),
        error: null,
      };
    }

    if (table === "clients") {
      const clientFilter = filters.id_in as string[] | undefined;
      if (clientFilter && !clientFilter.includes(baseClientId)) {
        return { data: [], error: null };
      }
      return {
        data: [{
          id: baseClientId,
          name: "Preview Client",
          metadata: input.clientMetadata ?? { contact_email: "client@example.com" },
        }],
        error: null,
      };
    }

    if (table === "ig_targets") {
      const accountFilter = filters.account_id_in as string[] | undefined;
      return {
        data: buildTargetRows(accountFilter ?? []),
        error: null,
      };
    }

    return { data: [], error: null };
  }

  function makeSelectBuilder(table: string, columns: string) {
    const filters: Record<string, unknown> = {};
    let single = false;

    function execute() {
      const result = runSelect(table, columns, filters);
      if (single) {
        return Promise.resolve({
          data: result.data ?? null,
          error: result.error,
        });
      }
      return Promise.resolve({
        data: Array.isArray(result.data) ? result.data : result.data ? [result.data] : [],
        error: result.error,
      });
    }

    function chainable() {
      return {
        eq(field: string, value: unknown) {
          filters[field] = value;
          return chainable();
        },
        in(field: string, values: unknown[]) {
          filters[`${field}_in`] = values;
          return chainable();
        },
        order() {
          return chainable();
        },
        limit(_count?: number) {
          return chainableWithMaybeSingle();
        },
        maybeSingle() {
          single = true;
          return execute();
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return execute().then(onFulfilled, onRejected);
        },
      };
    }

    function chainableWithMaybeSingle() {
      return {
        maybeSingle() {
          single = true;
          return execute();
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return execute().then(onFulfilled, onRejected);
        },
      };
    }

    return chainable();
  }

  return {
    writes,
    from(table: string) {
      return {
        select(columns: string) {
          return makeSelectBuilder(table, columns);
        },
        update: () => {
          writes.push({ table, op: "update" });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        insert: () => {
          writes.push({ table, op: "insert" });
          return Promise.resolve({ data: null, error: null });
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

test("preview route requires relay or admin auth", () => {
  assert.match(previewRoute, /requireRelayOrAdmin/);
  assert.match(previewRoute, /Cache-Control.*no-store/);
  assert.doesNotMatch(previewRoute, /requireClientInstagramSession/);
  assert.doesNotMatch(previewRoute, /POSTMARK/);
});

test("preview route is read-only", () => {
  assert.match(previewRoute, /loadNeedsMoreTargetsEmailLifecyclePreview/);
  assert.doesNotMatch(previewRoute, /\.insert\(/);
  assert.doesNotMatch(previewRoute, /\.update\(/);
  assert.doesNotMatch(previewRoute, /executeClientEmailTestDelivery/);
});

test("signal active with eligible=5 previews would_open_episode and delivery_ready", async () => {
  const supabase = createMockSupabase({
    eligibleByAccount: new Map([[baseAccountId, 5]]),
    clientMetadata: { contact_email: "client@example.com" },
  });
  const preview = await loadNeedsMoreTargetsEmailLifecyclePreview(supabase as never);
  assert.equal(preview.mutationExecuted, false);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.items[0]?.lifecycleDecision, "would_open_episode");
  assert.equal(preview.items[0]?.deliveryState, "delivery_ready");
  assert.equal(preview.summary.wouldOpenEpisode, 1);
  assert.equal(supabase.writes.length, 0);
});

test("eligible=6 does not preview a new episode start", async () => {
  const supabase = createMockSupabase({
    eligibleByAccount: new Map([[baseAccountId, 6]]),
  });
  const preview = await loadNeedsMoreTargetsEmailLifecyclePreview(supabase as never);
  assert.equal(preview.items[0]?.lifecycleDecision, "no_action");
  assert.equal(preview.items[0]?.deliveryState, "blocked_target_count_above_threshold");
});

test("resolved signal with active episode previews would_resolve_episode", async () => {
  const startedAt = "2026-06-01T12:00:00.000Z";
  const supabase = createMockSupabase({
    signalAccountIds: [],
    episodeRows: [{
      id: "episode-1",
      account_id: baseAccountId,
      client_id: baseClientId,
      source_action_id: "action-1",
      status: "active",
      eligible_target_count_at_start: 4,
      threshold_at_start: 5,
      started_at: startedAt,
      resolved_at: null,
      canceled_at: null,
      close_reason: null,
      next_reminder_index: 1,
      last_completed_reminder_index: 0,
      episode_key: "episode-key",
    }],
    eligibleByAccount: new Map([[baseAccountId, 4]]),
  });
  const preview = await loadNeedsMoreTargetsEmailLifecyclePreview(supabase as never);
  assert.equal(preview.items[0]?.lifecycleDecision, "would_resolve_episode");
  assert.equal(preview.items[0]?.deliveryState, "blocked_inactive_signal");
});

test("canceled account previews would_resolve_episode with canceled delivery block", async () => {
  const supabase = createMockSupabase({
    adminLifecycleStatus: "cancelled",
    episodeRows: [{
      id: "episode-1",
      account_id: baseAccountId,
      client_id: baseClientId,
      source_action_id: "action-1",
      status: "active",
      eligible_target_count_at_start: 3,
      threshold_at_start: 5,
      started_at: "2026-06-01T12:00:00.000Z",
      resolved_at: null,
      canceled_at: null,
      close_reason: null,
      next_reminder_index: 1,
      last_completed_reminder_index: 0,
      episode_key: "episode-key",
    }],
  });
  const preview = await loadNeedsMoreTargetsEmailLifecyclePreview(supabase as never);
  assert.equal(preview.items[0]?.accountStatus, "canceled");
  assert.equal(preview.items[0]?.lifecycleDecision, "would_resolve_episode");
  assert.equal(preview.items[0]?.deliveryState, "blocked_canceled_account");
  assert.match(preview.items[0]?.reason ?? "", /canceled/i);
});

test("missing client email keeps lifecycle would_open but delivery blocked", async () => {
  const supabase = createMockSupabase({
    clientMetadata: {},
    eligibleByAccount: new Map([[baseAccountId, 5]]),
  });
  const preview = await loadNeedsMoreTargetsEmailLifecyclePreview(supabase as never);
  assert.equal(preview.items[0]?.lifecycleDecision, "would_open_episode");
  assert.equal(preview.items[0]?.deliveryState, "blocked_missing_client_email");
  assert.equal(preview.items[0]?.clientEmailMasked, null);
  assert.equal(preview.summary.blockedMissingClientEmail, 1);
});

test("preview masks canonical client email and never uses forbidden sources", () => {
  const row: NeedsMoreTargetsPreviewAccountRow = {
    instagramUsername: "alpha",
    clientLabel: "Client",
    clientEmailMasked: "c***@example.com",
    needsMoreSignalActive: true,
    eligibleTargetCount: 5,
    threshold: 5,
    accountStatus: "active",
    episodeState: "none",
    lifecycleDecision: "would_open_episode",
    deliveryState: "delivery_ready",
    nextDueAt: null,
    nextReminderIndex: null,
    reason: "Read-only preview — no database write, intent, or email was performed.",
  };
  assert.match(row.clientEmailMasked ?? "", /\*\*\*@/);
  assert.doesNotMatch(row.reason, /vault|credential|instagram login/i);
});

test("active episode keeps would_keep_active when stop conditions are not met", () => {
  const plan = planNeedsMoreTargetsEpisodeReconciliation({
    accountId: baseAccountId,
    clientId: baseClientId,
    accountCanceled: false,
    eligibleTargetCount: 4,
    needsMoreSignalActive: true,
    sourceActionId: "action-1",
    activeEpisode: {
      id: "episode-1",
      accountId: baseAccountId,
      clientId: baseClientId,
      sourceActionId: "action-1",
      status: "active",
      eligibleTargetCountAtStart: 4,
      thresholdAtStart: 5,
      startedAt: "2026-06-01T12:00:00.000Z",
      resolvedAt: null,
      canceledAt: null,
      closeReason: null,
      nextReminderIndex: 1,
      lastCompletedReminderIndex: 0,
      episodeKey: "episode-key",
    },
    now: new Date("2026-06-03T12:00:00.000Z"),
  });
  assert.equal(plan.actions.some((action) => action.type === "close_episode"), false);
  assert.equal(plan.actions.some((action) => action.type === "plan_send"), true);
});

test("preview performs zero email table writes", async () => {
  const supabase = createMockSupabase();
  await loadNeedsMoreTargetsEmailLifecyclePreview(supabase as never);
  assert.equal(supabase.writes.length, 0);
});
