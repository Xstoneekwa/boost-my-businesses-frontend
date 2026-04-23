import type { SupabaseClient } from "@supabase/supabase-js";

type AnalyticsRow = Record<string, unknown>;

type NameSource = {
  table: string;
  idColumn: string;
  nameColumn: string;
};

const tenantNameSources: NameSource[] = [
  { table: "restaurant_tenants", idColumn: "id", nameColumn: "name" },
  { table: "restaurant_tenants", idColumn: "id", nameColumn: "tenant_name" },
  { table: "restaurant_tenants", idColumn: "id", nameColumn: "display_name" },
  { table: "restaurant_tenants", idColumn: "tenant_id", nameColumn: "name" },
  { table: "restaurant_tenants", idColumn: "tenant_id", nameColumn: "tenant_name" },
  { table: "restaurant_tenants", idColumn: "tenant_id", nameColumn: "display_name" },
  { table: "tenants", idColumn: "id", nameColumn: "name" },
  { table: "tenants", idColumn: "id", nameColumn: "tenant_name" },
  { table: "tenants", idColumn: "id", nameColumn: "display_name" },
  { table: "restaurants", idColumn: "tenant_id", nameColumn: "tenant_name" },
  { table: "restaurants", idColumn: "tenant_id", nameColumn: "name" },
];

const locationNameSources: NameSource[] = [
  { table: "restaurant_locations", idColumn: "id", nameColumn: "name" },
  { table: "restaurant_locations", idColumn: "id", nameColumn: "location_name" },
  { table: "restaurant_locations", idColumn: "id", nameColumn: "display_name" },
  { table: "restaurant_locations", idColumn: "location_id", nameColumn: "name" },
  { table: "restaurant_locations", idColumn: "location_id", nameColumn: "location_name" },
  { table: "restaurant_locations", idColumn: "location_id", nameColumn: "display_name" },
  { table: "locations", idColumn: "id", nameColumn: "name" },
  { table: "locations", idColumn: "id", nameColumn: "location_name" },
  { table: "locations", idColumn: "id", nameColumn: "display_name" },
];

function readString(row: AnalyticsRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return "";
}

function collectIds(rows: AnalyticsRow[], keys: string[]) {
  return Array.from(new Set(rows.map((row) => readString(row, keys)).filter(Boolean)));
}

async function fetchNameLookup(
  supabase: SupabaseClient,
  ids: string[],
  sources: NameSource[]
) {
  const lookup = new Map<string, string>();

  if (!ids.length) return lookup;

  for (const source of sources) {
    const missingIds = ids.filter((id) => !lookup.has(id));

    if (!missingIds.length) break;

    const { data, error } = await supabase
      .from(source.table)
      .select(`${source.idColumn}, ${source.nameColumn}`)
      .in(source.idColumn, missingIds)
      .returns<AnalyticsRow[]>();

    if (error || !data) continue;

    for (const row of data) {
      const id = readString(row, [source.idColumn]);
      const name = readString(row, [source.nameColumn]);

      if (id && name) lookup.set(id, name);
    }
  }

  return lookup;
}

export async function enrichTenantNames(supabase: SupabaseClient, rows: AnalyticsRow[]) {
  const ids = collectIds(rows, ["tenant_id", "tenantId"]);
  const namesById = await fetchNameLookup(supabase, ids, tenantNameSources);

  return rows.map((row) => {
    if (readString(row, ["tenant_name", "tenantName", "tenant_display_name", "display_name"])) return row;

    const tenantId = readString(row, ["tenant_id", "tenantId"]);
    const tenantName = tenantId ? namesById.get(tenantId) : undefined;

    return tenantName ? { ...row, tenant_name: tenantName } : row;
  });
}

export async function enrichLocationNames(supabase: SupabaseClient, rows: AnalyticsRow[]) {
  const ids = collectIds(rows, ["location_id", "locationId"]);
  const namesById = await fetchNameLookup(supabase, ids, locationNameSources);

  return rows.map((row) => {
    if (readString(row, ["location_name", "locationName", "location_display_name", "display_name"])) return row;

    const locationId = readString(row, ["location_id", "locationId"]);
    const locationName = locationId ? namesById.get(locationId) : undefined;

    return locationName ? { ...row, location_name: locationName } : row;
  });
}
