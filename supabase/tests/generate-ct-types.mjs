import { execFileSync } from "node:child_process";

const databaseUrl = process.env.CT_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("CT_TEST_DATABASE_URL is required");

const query = `
select jsonb_build_object(
  'columns', coalesce((
    select jsonb_agg(jsonb_build_object(
      'table',table_name,'column',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable='YES'
    ) order by table_name,ordinal_position)
    from information_schema.columns
    where table_schema='public' and (table_name like 'ct_%' or table_name='client_account_notifications')
  ),'[]'::jsonb),
  'rpcs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name',p.proname,'identity',p.oid::regprocedure::text,'result',pg_get_function_result(p.oid)
    ) order by p.proname,p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'ct_%_v1%'
  ),'[]'::jsonb)
)`;

const raw = execFileSync("psql", ["-X", "-Atq", databaseUrl, "-c", query], { encoding: "utf8" });
const schema = JSON.parse(raw.trim());
const tables = new Map();
for (const column of schema.columns) {
  const values = tables.get(column.table) ?? [];
  values.push(column);
  tables.set(column.table, values);
}

function tsType(column) {
  const type = column.udt === "uuid" || ["text","date","timestamp with time zone","timestamp without time zone","interval"].includes(column.type)
    ? "string"
    : ["integer","bigint","smallint","numeric","double precision","real"].includes(column.type)
      ? "number"
      : column.type === "boolean"
        ? "boolean"
        : column.type === "ARRAY"
          ? "string[]"
          : "unknown";
  return column.nullable ? `${type} | null` : type;
}

const lines = [
  "// Generated from the certified temporary PostgreSQL database. Do not edit manually.",
  "export interface CtDatabaseRowMap {",
];
for (const [table, columns] of tables) {
  lines.push(`  ${JSON.stringify(table)}: {`);
  for (const column of columns) lines.push(`    ${JSON.stringify(column.column)}: ${tsType(column)};`);
  lines.push("  };");
}
lines.push("}", "", "export interface CtDatabaseRpcMap {");
for (const rpc of schema.rpcs) {
  lines.push(`  ${JSON.stringify(rpc.identity)}: { readonly name: ${JSON.stringify(rpc.name)}; readonly result: ${JSON.stringify(rpc.result)} };`);
}
lines.push("}", "");
process.stdout.write(lines.join("\n"));
