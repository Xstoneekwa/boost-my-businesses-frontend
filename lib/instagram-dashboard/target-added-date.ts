type TargetDateRow = {
  created_at?: unknown;
};

export function resolveTargetAddedAt(row: TargetDateRow) {
  return typeof row.created_at === "string" && row.created_at.trim()
    ? row.created_at
    : null;
}
