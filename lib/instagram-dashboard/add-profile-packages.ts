export type AddProfileCommercialPackage =
  | "starter"
  | "pro"
  | "premium"
  | "custom"
  | "internal_test";

export type AddProfileRuntimeMode =
  | "safe_setup"
  | "follow_only_test"
  | "full_cycle"
  | "outreach_only";

export type AddProfileAddonCode =
  | "extra_ct_research"
  | "extra_outreach_volume"
  | "priority_warmup"
  | "advanced_reporting"
  | "manual_ops_support"
  | "custom_package_addon";

export const addProfilePackageOptions: Array<{
  value: AddProfileCommercialPackage;
  label: string;
  detail: string;
  commercialCode: string;
  selectable: boolean;
  planned: boolean;
}> = [
  {
    value: "starter",
    label: "Starter",
    detail: "Planned — maps to Growth caps when wired.",
    commercialCode: "growth",
    selectable: false,
    planned: true,
  },
  {
    value: "pro",
    label: "Pro",
    detail: "Planned — commercial Pro package.",
    commercialCode: "pro",
    selectable: false,
    planned: true,
  },
  {
    value: "premium",
    label: "Premium",
    detail: "Planned — commercial Premium package.",
    commercialCode: "premium",
    selectable: false,
    planned: true,
  },
  {
    value: "custom",
    label: "Custom",
    detail: "Operator-defined package; uses Pro defaults until Custom wiring ships.",
    commercialCode: "pro",
    selectable: true,
    planned: false,
  },
  {
    value: "internal_test",
    label: "Internal Test",
    detail: "Admin/test accounts on the Entry 2A test client. No auto-run.",
    commercialCode: "internal_test",
    selectable: true,
    planned: false,
  },
];

export const addProfileRuntimeOptions: Array<{
  value: AddProfileRuntimeMode;
  label: string;
  detail: string;
}> = [
  { value: "safe_setup", label: "Safe Setup", detail: "Assignment + settings only. No run/login." },
  { value: "follow_only_test", label: "Follow Only Test", detail: "Internal low-cap test profile." },
  { value: "full_cycle", label: "Full Cycle", detail: "Full-cycle schedule slots. No auto-run from Add Profile." },
  { value: "outreach_only", label: "Outreach Only", detail: "Outreach schedule profile. No auto-run from Add Profile." },
];

export const addProfileAddonOptions: Array<{
  value: AddProfileAddonCode;
  label: string;
  wired: boolean;
}> = [
  { value: "extra_ct_research", label: "Extra CT research", wired: false },
  { value: "extra_outreach_volume", label: "Extra outreach volume", wired: false },
  { value: "priority_warmup", label: "Priority warmup", wired: false },
  { value: "advanced_reporting", label: "Advanced reporting", wired: false },
  { value: "manual_ops_support", label: "Manual ops support", wired: false },
  { value: "custom_package_addon", label: "Custom package add-on", wired: false },
];

const commercialPackages = new Set(addProfilePackageOptions.map((row) => row.value));
const runtimeModes = new Set(addProfileRuntimeOptions.map((row) => row.value));
const addonCodes = new Set(addProfileAddonOptions.map((row) => row.value));

export function isAddProfileCommercialPackage(value: string): value is AddProfileCommercialPackage {
  return commercialPackages.has(value as AddProfileCommercialPackage);
}

export function isAddProfileRuntimeMode(value: string): value is AddProfileRuntimeMode {
  return runtimeModes.has(value as AddProfileRuntimeMode);
}

export function isAddProfileAddonCode(value: string): value is AddProfileAddonCode {
  return addonCodes.has(value as AddProfileAddonCode);
}

export function commercialPackageCodeForSelection(value: AddProfileCommercialPackage) {
  return addProfilePackageOptions.find((row) => row.value === value)?.commercialCode ?? "growth";
}

export function subscriptionTypeForRuntimeMode(runtimeMode: AddProfileRuntimeMode) {
  return runtimeMode === "outreach_only" ? "outreach_only" : "full_cycle";
}

export function defaultAddProfileCommercialPackage() {
  return "internal_test" as const;
}

export function packageLabelForSelection(value: AddProfileCommercialPackage) {
  return addProfilePackageOptions.find((row) => row.value === value)?.label ?? value;
}
