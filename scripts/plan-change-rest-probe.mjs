/**
 * Unified PostgREST table resolution for plan-change DB validation.
 * Never passes a qualified name like "public.clients" to Supabase JS .from().
 */

import { createClient } from "@supabase/supabase-js";

export const PUBLIC_SCHEMA = "public";

export function normalizeTableName(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("table name required");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("table name required");
  }
  if (trimmed.includes(".")) {
    const parts = trimmed.split(".");
    if (parts.length === 2 && parts[0] === PUBLIC_SCHEMA && parts[1]) {
      return parts[1];
    }
    throw new Error(`qualified table name not allowed for PostgREST .from(): ${trimmed}`);
  }
  return trimmed;
}

export function resolvePublicTable(tableName) {
  const table = normalizeTableName(tableName);
  return {
    schema: PUBLIC_SCHEMA,
    table,
    probeLabel: `schema=${PUBLIC_SCHEMA} table=${table}`,
  };
}

export function resolveSchemaTable(schemaName, tableName) {
  const schema = String(schemaName ?? "").trim();
  const table = normalizeTableName(tableName);
  if (!schema) {
    throw new Error("schema name required");
  }
  return {
    schema,
    table,
    probeLabel: `schema=${schema} table=${table}`,
  };
}

export function fromPublicTable(client, tableName) {
  const ref = resolvePublicTable(tableName);
  return {
    query: client.schema(ref.schema).from(ref.table),
    ref,
  };
}

export function fromSchemaTable(client, schemaName, tableName) {
  const ref = resolveSchemaTable(schemaName, tableName);
  return {
    query: client.schema(ref.schema).from(ref.table),
    ref,
  };
}

export function createPlanChangeAdminClient(url, serviceKey) {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: PUBLIC_SCHEMA },
  });
}

export function formatProbeLog(probeType, ref) {
  return `probe type=${probeType} ${ref.probeLabel}`;
}

export function isTableMissingError(message = "") {
  return /could not find the table|does not exist|schema cache|relation .* does not exist|404|PGRST205|PGRST106/i.test(
    message
  );
}

/**
 * Classify table existence from paired REST probes.
 * exists requires BOTH head-count and verify-select to succeed without missing-table errors.
 */
export function classifyTableProbeResponse(headResult, verifyResult) {
  const headMessage = headResult?.error?.message ?? headResult?.error ?? null;
  const verifyMessage = verifyResult?.error?.message ?? verifyResult?.error ?? null;
  const headError = headMessage ? String(headMessage) : null;
  const verifyError = verifyMessage ? String(verifyMessage) : null;

  if (isTableMissingError(headError) || isTableMissingError(verifyError)) {
    return {
      state: "missing",
      count: null,
      error: verifyError || headError || "table_missing",
    };
  }

  if (headError || verifyError) {
    return {
      state: "inaccessible",
      count: null,
      error: verifyError || headError || "probe_failed",
    };
  }

  if (typeof headResult?.count !== "number") {
    return {
      state: "inaccessible",
      count: null,
      error: "exact_count_unavailable_without_confirmed_table",
    };
  }

  return {
    state: "exists",
    count: headResult.count,
    error: null,
  };
}

export function formatInventoryProbeStatus(probe) {
  if (probe.state === "exists") {
    return `exists rows=${probe.count} (${probe.ref.probeLabel})`;
  }
  if (probe.state === "missing") {
    return `missing (${probe.ref.probeLabel}: ${probe.error})`;
  }
  return `inaccessible (${probe.ref.probeLabel}: ${probe.error})`;
}

export async function probePublicTableHeadCount(client, tableName, probeType = "inventory") {
  const { query, ref } = fromPublicTable(client, tableName);
  const head = await query.select("*", { head: true, count: "exact" });
  const verify = await query.select("*").limit(0);
  const classified = classifyTableProbeResponse(
    { error: head.error, count: head.count },
    { error: verify.error }
  );
  return {
    probeType,
    ref,
    ...classified,
  };
}

export async function probePublicTableSelect(client, tableName, probeType, buildQuery) {
  const { query, ref } = fromPublicTable(client, tableName);
  const built = buildQuery(query);
  const { data, error, count } = await built;
  return { probeType, ref, data, error: error?.message ?? null, count: count ?? null };
}
