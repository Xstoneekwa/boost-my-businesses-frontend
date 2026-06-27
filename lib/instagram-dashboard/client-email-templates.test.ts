import assert from "node:assert/strict";
import test from "node:test";
import {
  loadClientEmailTemplatesProjection,
  previewClientEmailTemplate,
  saveClientEmailTemplateVersion,
} from "./client-email-templates.ts";
import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";

const MISSING_TABLE_ERROR = {
  message: "Could not find the table 'public.client_email_templates' in the schema cache",
  code: "PGRST205",
};

type Row = Record<string, unknown>;

const SETTINGS_MISSING_TABLE_ERROR = {
  message: "Could not find the table 'public.transactional_email_delivery_settings' in the schema cache",
  code: "PGRST205",
};

function createMockSupabase(input: { templates?: Row[]; tableMissing?: boolean }) {
  const templates = [...(input.templates ?? [])];
  const tableMissing = input.tableMissing === true;

  function makeQuery(table: string) {
    const state = {
      filters: [] as Array<{ column: string; op: string; value: unknown }>,
      updateValues: null as Row | null,
      order: null as { column: string; ascending: boolean } | null,
      limitValue: 100,
    };

    const api = {
      select() { return api; },
      eq(column: string, value: unknown) {
        state.filters.push({ column, op: "eq", value });
        return api;
      },
      order(column: string, options?: { ascending?: boolean }) {
        state.order = { column, ascending: options?.ascending !== false };
        return api;
      },
      limit(count: number) {
        state.limitValue = count;
        if (table === "transactional_email_delivery_settings") {
          return Promise.resolve({ error: SETTINGS_MISSING_TABLE_ERROR });
        }
        return api;
      },
      maybeSingle: async () => {
        if (tableMissing) return { data: null, error: MISSING_TABLE_ERROR };
        const rows = filterRows(state);
        if (state.updateValues) rows.forEach((row) => Object.assign(row, state.updateValues));
        return { data: rows[0] ?? null, error: null };
      },
      update(values: Row) {
        state.updateValues = values;
        return api;
      },
      insert(values: Row) {
        const row = {
          id: `tpl-${templates.length + 1}`,
          allowed_variables: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: "tester",
          updated_by: "tester",
          ...values,
        };
        templates.push(row);
        const chain = {
          select: () => chain,
          maybeSingle: async () => ({ data: row, error: null }),
        };
        return chain;
      },
      then(
        onFulfilled?: (value: { data: Row[] | null; error: typeof MISSING_TABLE_ERROR | null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        if (tableMissing) return Promise.resolve({ data: null, error: MISSING_TABLE_ERROR }).then(onFulfilled, onRejected);
        const rows = filterRows(state);
        if (state.updateValues) rows.forEach((row) => Object.assign(row, state.updateValues));
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };

    function filterRows(state: { filters: Array<{ column: string; op: string; value: unknown }>; order: { column: string; ascending: boolean } | null; limitValue: number }) {
      let rows = templates.filter((row) => state.filters.every((filter) => {
        if (filter.op === "eq") return row[filter.column] === filter.value;
        return true;
      }));
      if (state.order) {
        rows = [...rows].sort((a, b) => {
          const left = a[state.order!.column];
          const right = b[state.order!.column];
          if (left === right) return 0;
          return (left as number) > (right as number) ? (state.order!.ascending ? 1 : -1) : (state.order!.ascending ? -1 : 1);
        });
      }
      return rows.slice(0, state.limitValue);
    }

    return api;
  }

  return {
    templates,
    from: makeQuery,
  };
}

test("missing email tables return neutral projection without writes", async () => {
  const supabase = createMockSupabase({ tableMissing: true });
  const projection = await loadClientEmailTemplatesProjection(supabase as never);
  assert.equal(projection.featureAvailable, false);
  assert.equal(projection.fromEmail, CLIENT_EMAIL_LOCKED_FROM);
  assert.equal(projection.templates.every((row) => !row.configured), true);
  assert.equal(supabase.templates.length, 0);
});

test("first template save creates active version 1", async () => {
  const supabase = createMockSupabase({});
  const result = await saveClientEmailTemplateVersion(supabase as never, {
    category: "needs_more_target_accounts",
    subject: "More targets for {{instagram_username}}",
    bodyText: "Hello {{client_name}}, please add targets at {{dashboard_url}}.",
    updatedBy: "botapp_operator",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.createdNewVersion, true);
  assert.equal(result.template.version, 1);
  assert.equal(result.template.status, "active");
  assert.equal(result.template.fromEmail, CLIENT_EMAIL_LOCKED_FROM);
});

test("editing template creates a new active version and retires previous", async () => {
  const supabase = createMockSupabase({
    templates: [{
      id: "tpl-1",
      category: "account_paused",
      version: 1,
      status: "active",
      subject: "Paused {{instagram_username}}",
      body_text: "Hi {{client_name}}",
      body_html: "<p>Hi</p>",
      allowed_variables: [],
      created_at: "2026-06-20T10:00:00.000Z",
      updated_at: "2026-06-20T10:00:00.000Z",
      created_by: "botapp",
      updated_by: "botapp",
    }],
  });

  const result = await saveClientEmailTemplateVersion(supabase as never, {
    category: "account_paused",
    subject: "Paused account {{instagram_username}}",
    bodyText: "Hello {{client_name}}, status {{account_status}}.",
    updatedBy: "botapp_operator",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.createdNewVersion, true);
  assert.equal(result.template.version, 2);
  assert.equal(supabase.templates.find((row) => row.id === "tpl-1")?.status, "retired");
  assert.equal(supabase.templates.filter((row) => row.status === "active").length, 1);
});

test("unknown variables are refused", async () => {
  const supabase = createMockSupabase({});
  const result = await saveClientEmailTemplateVersion(supabase as never, {
    category: "needs_assistance",
    subject: "Help {{client_name}}",
    bodyText: "Secret {{api_key}}",
    updatedBy: "botapp",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unknown_variables");
  assert.deepEqual(result.unknownVariables, ["api_key"]);
});

test("preview uses safe demonstration values without creating intents", async () => {
  const preview = previewClientEmailTemplate({
    subject: "Targets for {{instagram_username}}",
    bodyText: "Hello {{client_name}}",
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.fromEmail, CLIENT_EMAIL_LOCKED_FROM);
  assert.match(preview.preview.subject, /xstonekwa_backup_acc/);
});

test("identical save is idempotent without new version", async () => {
  const supabase = createMockSupabase({
    templates: [{
      id: "tpl-1",
      category: "account_canceled",
      version: 1,
      status: "active",
      subject: "Canceled {{instagram_username}}",
      body_text: "Bye {{client_name}}",
      body_html: "<p>Bye</p>",
      allowed_variables: [],
      created_at: "2026-06-20T10:00:00.000Z",
      updated_at: "2026-06-20T10:00:00.000Z",
      created_by: "botapp",
      updated_by: "botapp",
    }],
  });

  const result = await saveClientEmailTemplateVersion(supabase as never, {
    category: "account_canceled",
    subject: "Canceled {{instagram_username}}",
    bodyText: "Bye {{client_name}}",
    updatedBy: "botapp",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.createdNewVersion, false);
  assert.equal(supabase.templates.length, 1);
});
