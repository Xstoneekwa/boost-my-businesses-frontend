import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type CheckoutMockTables = {
  clients: Row[];
  tenant_users: Row[];
  client_users: Row[];
  client_subscriptions: Row[];
  commercial_checkout_sessions: Row[];
  client_account_entitlements: Row[];
  commercial_checkout_audit_events: Row[];
  ig_accounts: Row[];
  client_instagram_accounts: Row[];
};

export type CheckoutMockAuthUser = {
  id: string;
  email: string;
  password: string;
};

export type CheckoutMockOptions = {
  authUsers?: CheckoutMockAuthUser[];
  tables?: Partial<CheckoutMockTables>;
  failOnInsert?: Partial<Record<keyof CheckoutMockTables, number>>;
  failOnSelect?: Partial<Record<keyof CheckoutMockTables, { code: string; message: string }>>;
};

function cloneRow<T extends Row>(row: T): T {
  return structuredClone(row);
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function matchEq(row: Row, column: string, value: unknown) {
  return readString(row[column]) === readString(value);
}

function metadataContactEmail(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return readString((metadata as Row).contact_email).toLowerCase();
}

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createCheckoutMockSupabase(options: CheckoutMockOptions = {}) {
  const authUsers = [...(options.authUsers ?? [])];
  const tables: CheckoutMockTables = {
    clients: [...(options.tables?.clients ?? [])],
    tenant_users: [...(options.tables?.tenant_users ?? [])],
    client_users: [...(options.tables?.client_users ?? [])],
    client_subscriptions: [...(options.tables?.client_subscriptions ?? [])],
    commercial_checkout_sessions: [...(options.tables?.commercial_checkout_sessions ?? [])],
    client_account_entitlements: [...(options.tables?.client_account_entitlements ?? [])],
    commercial_checkout_audit_events: [...(options.tables?.commercial_checkout_audit_events ?? [])],
    ig_accounts: [...(options.tables?.ig_accounts ?? [])],
    client_instagram_accounts: [...(options.tables?.client_instagram_accounts ?? [])],
  };
  const insertAttempts: Partial<Record<keyof CheckoutMockTables, number>> = {};

  function shouldFailInsert(table: keyof CheckoutMockTables) {
    const target = options.failOnInsert?.[table];
    if (!target) return false;
    insertAttempts[table] = (insertAttempts[table] ?? 0) + 1;
    return insertAttempts[table] === target;
  }

  function buildQuery(table: keyof CheckoutMockTables) {
    let rows = [...tables[table]];
    const filters: Array<(row: Row) => boolean> = [];
    let orderColumn: string | null = null;
    let orderAsc = true;
    let limitCount: number | null = null;
    let headCount = false;
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;
    let pendingDelete = false;
    let returnMode: "array" | "single" | "maybeSingle" = "array";

    function applyFilters(source: Row[]) {
      return source.filter((row) => filters.every((filter) => filter(row)));
    }

    async function execute() {
      const selectFailure = options.failOnSelect?.[table];
      if (selectFailure && !pendingInsert && !pendingUpdate && !pendingDelete) {
        return { data: null, error: selectFailure };
      }

      if (pendingInsert) {
        if (shouldFailInsert(table)) {
          pendingInsert = null;
          return { data: null, error: { code: "23505", message: "insert failed" } };
        }
        const row = { id: readString(pendingInsert.id) || newId(table), ...pendingInsert };
        tables[table].push(cloneRow(row));
        pendingInsert = null;
        if (returnMode === "array") return { data: [cloneRow(row)], error: null };
        return { data: cloneRow(row), error: null };
      }
      if (pendingUpdate) {
        const matched = applyFilters(tables[table]);
        for (const row of matched) Object.assign(row, pendingUpdate);
        pendingUpdate = null;
        if (returnMode === "array") return { data: matched.map(cloneRow), error: null };
        return { data: matched[0] ? cloneRow(matched[0]) : null, error: null };
      }
      if (pendingDelete) {
        const matchedIds = new Set(applyFilters(tables[table]).map((row) => readString(row.id)));
        tables[table] = tables[table].filter((row) => !matchedIds.has(readString(row.id)));
        pendingDelete = false;
        return { data: null, error: null };
      }
      if (headCount) {
        return { data: null, error: null, count: applyFilters(rows).length };
      }

      let matched = applyFilters(rows);
      if (orderColumn) {
        matched = [...matched].sort((a, b) => {
          const av = readString(a[orderColumn!]);
          const bv = readString(b[orderColumn!]);
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limitCount !== null) matched = matched.slice(0, limitCount);

      if (returnMode === "array") return { data: matched.map(cloneRow), error: null };
      if (returnMode === "single") {
        if (!matched[0]) return { data: null, error: { code: "PGRST116", message: "not found" } };
        return { data: cloneRow(matched[0]), error: null };
      }
      return { data: matched[0] ? cloneRow(matched[0]) : null, error: null };
    }

    const api = {
      select(_columns?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count === "exact" && opts?.head) headCount = true;
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => matchEq(row, column, value));
        return api;
      },
      filter(column: string, operator: string, value: unknown) {
        if (column === "metadata->>contact_email" && operator === "eq") {
          filters.push((row) => metadataContactEmail(row.metadata) === readString(value).toLowerCase());
        }
        return api;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orderColumn = column;
        orderAsc = opts?.ascending !== false;
        return api;
      },
      limit(count: number) {
        limitCount = count;
        return api;
      },
      insert(payload: Row | Row[]) {
        pendingInsert = Array.isArray(payload) ? payload[0] : payload;
        return api;
      },
      update(payload: Row) {
        pendingUpdate = payload;
        return api;
      },
      delete() {
        pendingDelete = true;
        return api;
      },
      single() {
        returnMode = "single";
        return execute();
      },
      maybeSingle() {
        returnMode = "maybeSingle";
        return execute();
      },
      then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return execute().then(onFulfilled, onRejected);
      },
    };

    return api;
  }

  const supabase = {
    from(table: keyof CheckoutMockTables) {
      return buildQuery(table);
    },
    auth: {
      admin: {
        async listUsers() {
          return {
            data: { users: authUsers.map((user) => ({ id: user.id, email: user.email })) },
            error: null,
          };
        },
        async createUser(input: { email: string; password: string; email_confirm?: boolean }) {
          const existing = authUsers.find((user) => user.email === input.email.trim().toLowerCase());
          if (existing) return { data: { user: null }, error: { message: "already exists" } };
          const user = {
            id: newId("auth"),
            email: input.email.trim().toLowerCase(),
            password: input.password,
          };
          authUsers.push(user);
          return { data: { user: { id: user.id, email: user.email } }, error: null };
        },
        async getUserById(id: string) {
          const user = authUsers.find((entry) => entry.id === id);
          if (!user) return { data: { user: null }, error: { message: "missing" } };
          return { data: { user: { id: user.id, email: user.email } }, error: null };
        },
        async deleteUser(id: string) {
          const index = authUsers.findIndex((entry) => entry.id === id);
          if (index >= 0) authUsers.splice(index, 1);
          return { data: {}, error: null };
        },
      },
    },
  } as unknown as SupabaseClient;

  return {
    supabase,
    authUsers,
    tables,
    getCounts() {
      return {
        auth: authUsers.length,
        clients: tables.clients.length,
        tenant_users: tables.tenant_users.length,
        client_users: tables.client_users.length,
        subscriptions: tables.client_subscriptions.length,
        checkout_sessions: tables.commercial_checkout_sessions.length,
        entitlements: tables.client_account_entitlements.length,
        audit_events: tables.commercial_checkout_audit_events.length,
      };
    },
    seedPartialState(stage: "auth_client" | "tenant_users" | "client_users" | "subscription" | "checkout_session" | "entitlement" | "audit") {
      const email = "resume@example.com";
      const authUserId = "auth-resume-1";
      const clientId = "client-resume-1";
      if (!authUsers.length) {
        authUsers.push({ id: authUserId, email, password: "ValidPassword12!" });
      }
      if (!tables.clients.length) {
        tables.clients.push({
          id: clientId,
          status: "active",
          metadata: { contact_email: email, checkout_source: "simulated_checkout" },
        });
      }
      const order = ["tenant_users", "client_users", "client_subscriptions", "commercial_checkout_sessions", "client_account_entitlements", "commercial_checkout_audit_events"] as const;
      const stageMap: Record<typeof stage, number> = {
        auth_client: -1,
        tenant_users: 0,
        client_users: 1,
        subscription: 2,
        checkout_session: 3,
        entitlement: 4,
        audit: 5,
      };
      const stageIndex = stageMap[stage];
      if (stageIndex >= 0) {
        tables.tenant_users.push({ user_id: authUserId, tenant_id: clientId, role: "tenant" });
      }
      if (stageIndex >= 1) {
        tables.client_users.push({ id: "cu-1", client_id: clientId, auth_user_id: authUserId, status: "active", role: "owner" });
      }
      if (stageIndex >= 2) {
        tables.client_subscriptions.push({ id: "sub-1", client_id: clientId, status: "active" });
      }
      if (stageIndex >= 3) {
        tables.commercial_checkout_sessions.push({
          id: "session-1",
          client_id: clientId,
          auth_user_id: authUserId,
          status: "checkout_activated_test",
          idempotency_key: "idem-resume-1",
          created_at: "2026-01-01T00:00:00Z",
        });
      }
      if (stageIndex >= 4) {
        tables.client_account_entitlements.push({
          id: "ent-1",
          client_id: clientId,
          checkout_session_id: "session-1",
          status: "entitlement_reserved",
        });
      }
      if (stageIndex >= 5) {
        tables.commercial_checkout_audit_events.push({
          id: "audit-1",
          checkout_session_id: "session-1",
          client_id: clientId,
          event_type: "simulated_checkout_activated",
        });
      }
    },
  };
}

export function mockPasswordSignIn(authUsers: CheckoutMockAuthUser[]) {
  return async (input: { email: string; password: string }) => {
    const user = authUsers.find(
      (entry) => entry.email === input.email.trim().toLowerCase() && entry.password === input.password,
    );
    if (!user) {
      return { data: { user: null, session: null }, error: { message: "invalid credentials" } };
    }
    return {
      data: {
        user: { id: user.id, email: user.email },
        session: { access_token: "mock-access-token", refresh_token: "mock-refresh-token" },
      },
      error: null,
    };
  };
}
