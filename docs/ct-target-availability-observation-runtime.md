# Target Availability observation runtime — V2-1 dormant

## Boundary

The Worker observes only facts already produced by CT rotation. The Backend maps the versioned payload to pure evidence. Neither side navigates Instagram for Availability, decides lifecycle, updates `ig_targets`, archives, renames, replaces, notifies or emails.

The two least-risk Worker hooks are `ct_rotation_target_loaded` and `ct_rotation_existing_summary`. With capture OFF they return before scope construction, thread creation or network access. Existing lookup/profile/Followers/pagination/recovery signals are reused; missing facts remain `unknown`.

## Taxonomy

1. raw observation: immutable Worker payload;
2. evidence: normalized Backend fact with source/run/device;
3. assessment: Availability conclusion with confidence and freshness;
4. lifecycle/policy shadow: recommendation only.

`runtime_error_non_exhaustion` remains non-terminal. Its classifier prevents checkpoint, credential, identity, device, rate-limit, wrong-surface, popup, crash and exception failures from becoming CT exhaustion; V2-1 requires no navigation patch.

## Stable identity

A stable Instagram ID is accepted only when an already-certified signal exposes it (`stable_platform_user_id`, `metadata_safe.instagram_user_id` or `metadata_safe.external_profile_id`). Current UI navigation does not reliably expose a numeric ID, so V2-1 adds no lookup. Username similarity is never identity proof.
