export type AddProfileCommercialPackage =
  | "growth"
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
    value: "growth",
    label: "Growth",
    detail: "Production Growth package. Full-cycle ready; Outreach remains optional.",
    commercialCode: "growth",
    selectable: true,
    planned: false,
  },
  {
    value: "starter",
    label: "Starter (legacy)",
    detail: "Legacy alias for Growth; kept for existing payload compatibility.",
    commercialCode: "growth",
    selectable: false,
    planned: false,
  },
  {
    value: "pro",
    label: "Pro",
    detail: "Production Pro package with Welcome enabled by default. Outreach remains optional.",
    commercialCode: "pro",
    selectable: true,
    planned: false,
  },
  {
    value: "premium",
    label: "Premium",
    detail: "Production Premium package with advanced targeting defaults. Outreach remains optional.",
    commercialCode: "premium",
    selectable: true,
    planned: false,
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
  { value: "extra_outreach_volume", label: "Extra outreach volume", wired: true },
  { value: "priority_warmup", label: "Priority warmup", wired: false },
  { value: "advanced_reporting", label: "Advanced reporting", wired: false },
  { value: "manual_ops_support", label: "Manual ops support", wired: false },
  { value: "custom_package_addon", label: "Custom package add-on", wired: false },
];

const commercialPackages = new Set(addProfilePackageOptions.map((row) => row.value));
const runtimeModes = new Set(addProfileRuntimeOptions.map((row) => row.value));
const addonCodes = new Set(addProfileAddonOptions.map((row) => row.value));

export type AddProfilePackagePreset = {
  selection: AddProfileCommercialPackage;
  commercialPackageCode: "growth" | "pro" | "premium" | "internal_test";
  label: string;
  defaultFollowDayCap: number;
  defaultUnfollowDayCap: number;
  defaultFollowSessionCap: number;
  defaultUnfollowSessionCap: number;
  defaultWelcomeEnabled: boolean;
  defaultOutreachEnabled: boolean;
  defaultWelcomeDayCap: number | null;
  defaultOutreachDayCap: number | null;
  advancedCtEnabled: boolean;
  aiCommentEnabled: boolean;
  aiTargetingEnabled: boolean;
  followEnabled: boolean;
  likeEnabled: boolean;
  muteAfterFollowEnabled: boolean;
  unfollowEnabled: boolean;
  welcomeEnabled: boolean;
  outreachEnabled: boolean;
  welcomePerSessionLimit: number;
  welcomePerDayLimit: number;
  outreachPerSessionLimit: number;
  outreachPerDayLimit: number;
  totalDmPerDayLimit: number;
  unfollowAfterDays: number;
  unfollowMode: "unfollow" | "unfollow-any";
  followFilters: {
    dontFollowPrivateAccounts: boolean;
    minFollowers: number;
    maxFollowers: number;
    minPosts: number;
  };
  metadataSafe: Record<string, string | number | boolean | null>;
};

const baseCommercialPresets: Record<AddProfilePackagePreset["commercialPackageCode"], Pick<
  AddProfilePackagePreset,
  | "commercialPackageCode"
  | "label"
  | "defaultFollowDayCap"
  | "defaultUnfollowDayCap"
  | "defaultFollowSessionCap"
  | "defaultUnfollowSessionCap"
  | "defaultWelcomeEnabled"
  | "defaultOutreachEnabled"
  | "defaultWelcomeDayCap"
  | "defaultOutreachDayCap"
  | "advancedCtEnabled"
  | "aiCommentEnabled"
  | "aiTargetingEnabled"
>> = {
  growth: {
    commercialPackageCode: "growth",
    label: "Growth",
    defaultFollowDayCap: 80,
    defaultUnfollowDayCap: 80,
    defaultFollowSessionCap: 80,
    defaultUnfollowSessionCap: 80,
    defaultWelcomeEnabled: false,
    defaultOutreachEnabled: false,
    defaultWelcomeDayCap: null,
    defaultOutreachDayCap: null,
    advancedCtEnabled: false,
    aiCommentEnabled: false,
    aiTargetingEnabled: false,
  },
  pro: {
    commercialPackageCode: "pro",
    label: "Pro",
    defaultFollowDayCap: 120,
    defaultUnfollowDayCap: 120,
    defaultFollowSessionCap: 120,
    defaultUnfollowSessionCap: 120,
    defaultWelcomeEnabled: true,
    defaultOutreachEnabled: false,
    defaultWelcomeDayCap: 10,
    defaultOutreachDayCap: null,
    advancedCtEnabled: true,
    aiCommentEnabled: false,
    aiTargetingEnabled: false,
  },
  premium: {
    commercialPackageCode: "premium",
    label: "Premium",
    defaultFollowDayCap: 120,
    defaultUnfollowDayCap: 120,
    defaultFollowSessionCap: 120,
    defaultUnfollowSessionCap: 120,
    defaultWelcomeEnabled: true,
    defaultOutreachEnabled: false,
    defaultWelcomeDayCap: 10,
    defaultOutreachDayCap: null,
    advancedCtEnabled: true,
    aiCommentEnabled: true,
    aiTargetingEnabled: true,
  },
  internal_test: {
    commercialPackageCode: "internal_test",
    label: "Internal Test",
    defaultFollowDayCap: 20,
    defaultUnfollowDayCap: 20,
    defaultFollowSessionCap: 20,
    defaultUnfollowSessionCap: 20,
    defaultWelcomeEnabled: false,
    defaultOutreachEnabled: false,
    defaultWelcomeDayCap: null,
    defaultOutreachDayCap: null,
    advancedCtEnabled: false,
    aiCommentEnabled: false,
    aiTargetingEnabled: false,
  },
};

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
  return "growth" as const;
}

export function packageLabelForSelection(value: AddProfileCommercialPackage) {
  return addProfilePackageOptions.find((row) => row.value === value)?.label ?? value;
}

export function resolveAddProfilePackagePreset(input: {
  commercialPackage: AddProfileCommercialPackage;
  runtimeMode: AddProfileRuntimeMode;
  addons?: AddProfileAddonCode[];
}): AddProfilePackagePreset {
  const commercialCode = commercialPackageCodeForSelection(input.commercialPackage) as AddProfilePackagePreset["commercialPackageCode"];
  const base = baseCommercialPresets[commercialCode] ?? baseCommercialPresets.growth;
  const addonSet = new Set(input.addons ?? []);
  const fullCycleRuntime = input.runtimeMode === "full_cycle";
  const followRuntime = input.runtimeMode === "follow_only_test" || fullCycleRuntime;
  const outreachAddonEnabled = addonSet.has("extra_outreach_volume") || addonSet.has("custom_package_addon");
  const outreachEnabled = input.runtimeMode === "outreach_only" && outreachAddonEnabled;
  const welcomeEnabled = fullCycleRuntime && base.defaultWelcomeEnabled;
  const unfollowEnabled = fullCycleRuntime;

  return {
    ...base,
    selection: input.commercialPackage,
    followEnabled: followRuntime,
    likeEnabled: followRuntime,
    muteAfterFollowEnabled: followRuntime,
    unfollowEnabled,
    welcomeEnabled,
    outreachEnabled,
    welcomePerSessionLimit: Math.min(base.defaultWelcomeDayCap ?? 10, 10),
    welcomePerDayLimit: base.defaultWelcomeDayCap ?? 10,
    outreachPerSessionLimit: outreachEnabled ? 5 : 0,
    outreachPerDayLimit: outreachEnabled ? (base.defaultOutreachDayCap ?? 30) : 0,
    totalDmPerDayLimit: (base.defaultWelcomeDayCap ?? 10) + (outreachEnabled ? (base.defaultOutreachDayCap ?? 30) : 0),
    unfollowAfterDays: 3,
    unfollowMode: "unfollow",
    followFilters: {
      dontFollowPrivateAccounts: true,
      minFollowers: 1,
      maxFollowers: 2147483647,
      minPosts: 1,
    },
    metadataSafe: {
      source: "add_profile",
      source_surface: "admin_dashboard",
      package_code: base.commercialPackageCode,
      runtime_mode: input.runtimeMode,
      outreach_enabled_by_addon: outreachEnabled,
    },
  };
}
