# Settings Domain Wiring Plan

Date: 2026-05-30
Scope: Instagram dashboard settings cleanup and future domain API wiring.
Status: planning + frontend-only cleanup. No runtime wiring, no worker change, no `config.py` change, no migration, no env change.

## 1. Current Verdict

**NO-GO for Prod Run Defaults Freeze.**

The Runtime Settings Readiness Matrix shows a split-brain settings model: the dashboard still writes mostly to `ig_account_settings` and `ig_account_filters`, while the Python worker reads domain tables and config/env gates such as `ig_account_dm_settings`, `ig_account_unfollow_settings`, `ig_account_follow_settings`, `ig_targets`, `ig_interacted_users`, and worker config.

**GO for Settings Cleanup 2** because it is frontend-only and reduces misleading controls without changing runtime behavior.

## 2. Cleanup 2 Field Decisions

Product rule: a visible control must either have proven runtime effect or be a useful, safe admin utility. Otherwise it should be hidden, read-only, ops-only, future-domain-only, or removed from standard UI.

### Keep Visible Now

| Surface | Fields/actions | Reason |
|---|---|---|
| Account tools | Stats, Logs, Stop run, Settings, Targets, Archive, Move to trash, Restore account | Proven or useful audited admin utilities. |
| Settings drawer General | `username`, `display_name`, `device_name`, `email_display`, `password_status`, `device_assignment`, `app_package_status`, `clone_assignment_status`, `account_status` | Safe read-only projections only. |
| Settings drawer Advanced | `current_run_status`, `last_error`, `last_successful_action`, `manual_stop_requested` | Safe read-only projections only; real actions use Stop run/lifecycle/logs. |
| Targets modal | Add, bulk import, reset, archive, restore, eligibility/perf/FBR read-only metrics | CT path is the closest current domain-backed admin surface. |
| Add Profile wizard | username, password write-only, device/clone/template admin inputs | Account creation and credential handoff are admin utilities; password remains write-only. |
| Read-only pages | Activity Log, Devices, Radar, Server Check, DM Templates, Growth Settings | Allowed while copy stays clear that projections are not runtime-editable defaults. |

### Converted Read-Only Now

| Fields | Reason |
|---|---|
| `username`, `display_name`, `device_name` | Identity/device projections should not write legacy settings from the drawer. |
| `last_successful_action` | Editing it corrupts audit semantics; runtime source should be logs/events. |

### Hidden Now From Standard Drawer

| Group | Fields |
|---|---|
| Schedule/session | `timeslot_start`, `timeslot_end`, `total_sessions`, `stop_interactions_after_minutes`, `pause_account_days`, `pause_account_until`, `randomize_start_enabled` |
| Action quotas | `follow_limit`, `total_follows_limit`, `total_unfollows_limit`, `unfollow_delay_days`, `total_likes_limit`, `likes_per_follow_min`, `likes_per_follow_max` |
| DM legacy controls | `welcome_dm_enabled`, `welcome_dm_message`, `cold_dm_enabled`, `cold_dm_message`, `max_dm_per_run`, `max_consecutive_dms`, `check_chat_before_welcoming`, `safe_review_mode` |
| Followback/unfollow legacy controls | `followback_on_followers`, `max_followback_skips`, `max_followback_ignore`, `sort_followers_mode`, `unfollow_non_followers`, `unfollow_any`, `unfollow_skip_limit`, `mute_posts_after_follow`, `mute_stories_after_follow`, `do_follows_first` |
| Sources legacy controls | `truncate_sources_min`, `truncate_sources_max`, `delete_interacted_users`, `change_source_if_crash`, `skipped_posts_limit`, `fling_when_skipped` |
| Filters legacy panel | `disable_filters`, `skip_followers`, `skip_following`, `skip_business_profiles`, `skip_non_business_profiles`, `follow_private_profiles`, `follow_only_private_profiles`, `dm_private_profiles`, `min_followers`, `max_followers`, `min_following`, `max_following`, `min_posts`, `blacklisted_words`, `mandatory_words`, `whitelist_words`, `blacklist_accounts` |
| Safety legacy controls | `total_interactions_limit`, `total_successful_interactions_limit`, `interactions_count`, `end_if_follow_limit_reached`, `end_if_dm_limit_reached`, `end_if_likes_limit_reached`, `max_actions_per_hour`, `max_actions_per_day`, `random_delay_min_seconds`, `random_delay_max_seconds`, `warmup_mode`, `stop_on_suspicious_screen`, `stop_on_login_challenge`, `stop_on_checkpoint`, `stop_on_repeated_navigation_failure`, `max_repeated_errors` |

### Move Ops-Only Later

Real action gates, dry-run gates, update locks, Play Store locks, device internals, clone package internals, incident notification channels, strict phase completion, auto-restart tuning, raw social-memory deletion, and destructive unfollow real-action controls must remain out of standard/client UI. If exposed later, they need an ops-only panel with audit, role checks, confirmation, and env hard gates.

### Needs Domain API

DM settings, unfollow settings, follow settings, filters, package caps, session scheduling, and audited action queues need new or revised domain APIs before returning to editable UI.

## 3. Domain Wiring Plan

| Domain | Current UI fields | Legacy DB fields | Target domain table/API | Runtime consumer expected | Migration needed | Audit needed | Client-safe | BotApp-safe | Priority | Risks | Recommended patch sequence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DM Templates / DM Settings | `welcome_dm_enabled`, `welcome_dm_message`, `cold_dm_enabled`, `cold_dm_message`, `max_dm_per_run`, `check_chat_before_welcoming` | `ig_account_settings.*` DM keys | `ig_account_dm_settings`, template approval API, DM template/job API | `account_session_orchestrator`, `welcome_*`, `outreach_session_orchestrator`, `dm_sender_engine` | Maybe for template versions/status | Yes | Limited after proof | Read-only first | P0 | DM spam, content drift, duplicate sends | Add read API, show effective values, add audited PATCH for safe fields, keep real-send env-only. |
| Unfollow Settings | `unfollow_delay_days`, `total_unfollows_limit`, `unfollow_non_followers`, `unfollow_any`, `unfollow_skip_limit` | legacy action/followback keys | `ig_account_unfollow_settings` API | `unfollow_settings`, `unfollow_session_orchestrator`, `unfollow_eligibility_engine` | Maybe for missing columns/versioning | Yes | Admin-only initially | Read-only initially | P0 | Destructive unfollows, mode ambiguity | Read projection first, map mode explicitly, add caps as `min(DB, package, env)`, require confirmation. |
| Follow Settings | `follow_limit`, `total_follows_limit`, `follow_private_profiles`, mute/like-after-follow fields | legacy action/filter/followback keys | `ig_account_follow_settings`, follow policy API | runner/followers engine, follow settings loader | Likely yes for limits/policy | Yes | Later | Read-only first | P1 | Follow spam, private-profile semantic inversion | Start with `dont_follow_private_accounts`, then add effective cap telemetry, then editable policy. |
| Filters | min/max followers/following/posts, business/private filters, words/account lists | `ig_account_filters` | follow/filter eligibility policy API | visual/profile eligibility engine | Likely yes or table replacement | Yes | Later, only safe subset | Read-only first | P1 | Client sees filters that worker ignores; semantic conflicts | Freeze UI, define source of truth, reconcile private-profile toggles, prove worker reads. |
| Package / Caps / Entitlements | package labels, day/session caps, 80/80, 120/120 | scattered legacy caps and dashboard projections | entitlement/package policy API | all action orchestrators through effective cap resolver | Yes | Yes | Read-only | Read-only | P1 | Pricing/runtime divergence | Define packages, compute effective caps, expose projection before editability. |
| Session / Scheduling | timeslots, total sessions, 6h window, phone rest, pause fields, auto-restart/resume | legacy schedule keys | provisioning/session scheduler policy API and lifecycle action API | dispatcher/scheduler/orchestrator | Yes | Yes | Limited pause controls later | Read-only first | P2 | Overlapping sessions, device overuse, false pause promise | Separate lifecycle pause from scheduler, add optimistic locking, then scheduler writes. |
| Ops / Kill Switches | dry-run, send/follow/unfollow/like gates, device/update/debug | legacy hidden keys or env/config | ops-only API or no UI; env remains authority | worker config/env gates | Maybe no | Yes | No | No | P0/P2 | Real actions, device instability, secret leakage | Keep hidden, document env authority, add ops panel only after RBAC/audit. |

## 4. API Readiness Requirements

Every future domain API must include:

- Idempotent writes keyed by `account_id` and domain.
- `updated_at` or version checks to avoid silent overwrites by multiple admins/clients.
- Audit events with actor, field set, old/new redacted summaries, and reason.
- Partial-success reporting for multi-field or multi-account updates.
- Rollback strategy or explicit compensation for multi-step operations.
- Package entitlement enforcement at API boundary.
- Runtime hard cap enforcement as `effective = min(package, DB, env hard cap, day remaining)`.
- No duplicate jobs/actions when templates, CT, or DM queues are involved.
- Provider rate/backpressure handling for any provider-backed verification or account lookup.
- No silent divergence between admin UI, client UI, BotApp, and worker runtime.

## 5. Recommended Patch Sequence

1. **Cleanup 2 UI reduction**: keep only safe read-only projections in the standard settings drawer; hide filters from account tools.
2. **Domain read APIs**: expose read-only effective DM/unfollow/follow/filter/package/session projections.
3. **DM domain write API**: audited writes for `welcome_enabled`, `outreach_enabled`, limits, template references, and check-chat; real-send remains env-only.
4. **Unfollow domain write API**: audited writes for enabled/mode/delay/session/day caps with destructive confirmations and env kill switch display.
5. **Follow/filter policy read proof**: prove worker consumption and resolve private-profile semantics before any client editing.
6. **Package/cap resolver**: centralize package caps and effective limits.
7. **Scheduler/lifecycle split**: separate account pause lifecycle from session scheduling and phone rest.
8. **BotApp/client projections**: expose read-only effective settings first, then selectively allow safe edits after audit and concurrency controls.

## 6. No-Leak Confirmation

This plan contains table names, field names, and architecture notes only. It does not include API keys, SearchApi keys, cron tokens, service role values, complete Authorization headers, cookies/sessions, passwords, full secret references, Vault UUIDs, provider responses, raw metadata, env secret values, or webhook URLs.
