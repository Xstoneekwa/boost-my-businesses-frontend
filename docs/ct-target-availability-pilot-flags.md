# Target Availability pilot flags — strict dormant contract

## Scope

Target Availability has four independent server-side flags:

- `TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED`
- `TARGET_AVAILABILITY_WRITER_ENABLED`
- `TARGET_AVAILABILITY_SHADOW_ENABLED`
- `TARGET_AVAILABILITY_POLICY_SHADOW_ENABLED`

They share one mandatory account-scoped pilot allowlist:

- `TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST`

The allowlist accepts either comma-separated account UUIDs or a JSON array of account UUIDs. Values are trimmed, lower-cased and deduplicated. Any malformed entry invalidates the entire allowlist. Usernames, tenant identifiers, package names, entitlements and wildcards are never accepted as activation scope.

## Enablement invariant

A feature is enabled for one account only when all of the following are true:

1. its own flag is exactly boolean `true` or the case-insensitive string `"true"`;
2. the shared allowlist is valid and non-empty;
3. the normalized `account_id` is explicitly present in that allowlist;
4. `TARGET_AVAILABILITY_KILL_SWITCH` is not enabled.

Every other state is OFF. This includes an absent or unreadable configuration source, an empty value, malformed JSON, an invalid separator, a wildcard, a partial list, an invalid account ID, a Premium package without an allowlist and a flag enabled without an allowlist.

## Dormant deployment

The dormant Backend deployment requires no production environment-variable change. No real account is configured during Gate 2. A later pilot requires a separate explicit gate that names synthetic validation first and then the exact production `account_id` only after approval.

The current V2-1 package has no runtime caller for the flag resolver, writer or shadow functions. Enabling an environment variable alone cannot create an observation, assessment, lifecycle decision, replacement, notification or email.
