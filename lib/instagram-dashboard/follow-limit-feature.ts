export function followLimitOverrideV1Enabled(env: NodeJS.ProcessEnv = process.env) {
  return env.FOLLOW_LIMIT_OVERRIDE_V1_ENABLED === "true";
}
