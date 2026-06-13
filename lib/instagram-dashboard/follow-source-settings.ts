export const FOLLOW_SOURCE_ROTATION_DEFAULTS = {
  max_follows_per_target_per_run: 27,
  max_targets_per_run: 4,
} as const;

export const FOLLOW_SOURCE_ROTATION_BOUNDS = {
  max_follows_per_target_per_run: { min: 1, max: 50 },
  max_targets_per_run: { min: 1, max: 10 },
} as const;

export type FollowSourceRotationField = keyof typeof FOLLOW_SOURCE_ROTATION_BOUNDS;

export type FollowSourceRotationSummary = {
  max_follows_per_target_per_run: number;
  max_targets_per_run: number;
  source: string;
};

export function followSourceRotationDefaultsForPackage(packageLabel: string | null | undefined) {
  const normalized = (packageLabel ?? "").trim().toLowerCase();
  const maxFollows =
    normalized.includes("premium") || normalized.includes("pro")
      ? 30
      : FOLLOW_SOURCE_ROTATION_DEFAULTS.max_follows_per_target_per_run;
  return {
    max_follows_per_target_per_run: maxFollows,
    max_targets_per_run: FOLLOW_SOURCE_ROTATION_DEFAULTS.max_targets_per_run,
  };
}

export function validateFollowSourceRotationInteger(
  value: unknown,
  fieldName: FollowSourceRotationField,
): { value: number; error: string } {
  const bounds = FOLLOW_SOURCE_ROTATION_BOUNDS[fieldName];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { value: 0, error: `${fieldName}_invalid` };
  }
  if (value < bounds.min || value > bounds.max) {
    return { value: 0, error: `${fieldName}_out_of_bounds_${bounds.min}_${bounds.max}` };
  }
  return { value, error: "" };
}

export function followSourceRotationChangedFields(
  before: Pick<FollowSourceRotationSummary, "max_follows_per_target_per_run" | "max_targets_per_run">,
  after: Pick<FollowSourceRotationSummary, "max_follows_per_target_per_run" | "max_targets_per_run">,
) {
  return [
    before.max_follows_per_target_per_run !== after.max_follows_per_target_per_run
      ? "max_follows_per_target_per_run"
      : "",
    before.max_targets_per_run !== after.max_targets_per_run ? "max_targets_per_run" : "",
  ].filter(Boolean);
}

export function redactedFollowSourceRotationSummary(input: FollowSourceRotationSummary) {
  return {
    max_follows_per_target_per_run: input.max_follows_per_target_per_run,
    max_targets_per_run: input.max_targets_per_run,
    source: input.source,
  };
}
