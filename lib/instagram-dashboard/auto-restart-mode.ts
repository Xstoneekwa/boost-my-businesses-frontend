export type AutoRestartStoredMode = "production" | "active" | "dry_run" | "disabled";

export function normalizeAutoRestartStoredMode(value: unknown): "production" {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "production" || mode === "active") return "production";
  if (mode === "dry_run" || mode === "disabled" || !mode) return "production";
  return "production";
}

export function isAutoRestartProductionExecutable(enabled: boolean, mode: string) {
  if (!enabled) return false;
  const normalized = normalizeAutoRestartStoredMode(mode);
  return normalized === "production";
}

export function autoRestartProductionModeLabel() {
  return "Production";
}
