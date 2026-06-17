import { createSupabaseClient } from "@/lib/supabase";

type SupabaseRecord = Record<string, unknown>;

const PACKAGE_PRIORITY: Record<string, number> = {
  premium: 100,
  pro: 80,
  growth: 40,
  internal_test: 10,
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function isPackageRowActive(row: SupabaseRecord, nowMs: number) {
  if (readString(row.status, "").toLowerCase() !== "active") return false;
  const endsAt = readString(row.ends_at, "");
  if (!endsAt) return true;
  const endMs = new Date(endsAt).getTime();
  return !Number.isNaN(endMs) && endMs > nowMs;
}

function pickBestPackageCode(rows: SupabaseRecord[]) {
  const sorted = [...rows].sort((left, right) => {
    const leftCode = readString(left.package_code, "growth").toLowerCase();
    const rightCode = readString(right.package_code, "growth").toLowerCase();
    const leftPriority = PACKAGE_PRIORITY[leftCode] ?? 0;
    const rightPriority = PACKAGE_PRIORITY[rightCode] ?? 0;
    if (rightPriority !== leftPriority) return rightPriority - leftPriority;
    const leftStarts = new Date(readString(left.starts_at, "")).getTime();
    const rightStarts = new Date(readString(right.starts_at, "")).getTime();
    return (Number.isFinite(rightStarts) ? rightStarts : 0) - (Number.isFinite(leftStarts) ? leftStarts : 0);
  });
  return readString(sorted[0]?.package_code, "growth").toLowerCase() || "growth";
}

/** Resolve the effective commercial package for an account (prefers account_package_summary). */
export async function resolveAccountPackageCode(accountId: string) {
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) return "growth";

  const supabase = createSupabaseClient();
  const { data: summary } = await supabase
    .from("account_package_summary")
    .select("commercial_package_code")
    .eq("account_id", normalizedAccountId)
    .maybeSingle();

  const summaryCode = readString((summary as SupabaseRecord | null)?.commercial_package_code, "").toLowerCase();
  if (summaryCode) return summaryCode;

  const { data: packageRows, error } = await supabase
    .from("account_commercial_packages")
    .select("package_code,status,starts_at,ends_at")
    .eq("account_id", normalizedAccountId)
    .eq("status", "active");

  if (error || !Array.isArray(packageRows) || packageRows.length === 0) return "growth";

  const nowMs = Date.now();
  const activeRows = (packageRows as SupabaseRecord[]).filter((row) => isPackageRowActive(row, nowMs));
  if (activeRows.length === 0) return "growth";
  return pickBestPackageCode(activeRows);
}
