# Runtime Settings Readiness Matrix

Date: 2026-05-30  
Scope: Instagram dashboard frontend in `boost-ai-frontend` and Phone Farm runtime in `instagram-worker-python`.  
Status: read-only audit report. No runtime wiring, no prod default change, no migration, no env change, no worker change.

## 1. Executive Summary

Settings Cleanup 1 removed the highest-risk controls from the standard Settings drawer, but the runtime readiness picture is still not prod-ready.

The key finding is that most dashboard settings still persist to legacy UI tables (`ig_account_settings`, `ig_account_filters`) while the Python runtime reads domain tables and config/env gates (`ig_account_dm_settings`, `ig_account_unfollow_settings`, `ig_account_follow_settings`, `ig_targets`, `ig_dm_jobs`, runtime config). A saved dashboard value is therefore not proof of runtime effect.

Verdict: **NO-GO for Prod Run Defaults Freeze**. The next patch must either keep these fields hidden/read-only or wire a small approved subset through audited domain APIs with hard caps.

## 2. Files Inspected

Frontend:

- `app/instagram-dashboard/InstagramDashboardButtons.tsx`
- `app/instagram-dashboard/AddProfileWizard.tsx`
- `app/instagram-dashboard/growth-settings/page.tsx`
- `app/instagram-dashboard/growth-settings-data.ts`
- `app/instagram-dashboard/dm-templates/page.tsx`
- `app/instagram-dashboard/dm-templates-data.ts`
- `app/instagram-dashboard/InstagramAccountTargetsPanel.tsx`
- `app/instagram-dashboard/targets-data.ts`
- `app/instagram-dashboard/page.tsx`
- `app/instagram-dashboard/accounts/[accountId]/page.tsx`
- `app/instagram-dashboard/client-accounts/page.tsx`
- `app/instagram-dashboard/credentials-actions/page.tsx`
- `app/instagram-dashboard/devices/page.tsx`
- `app/instagram-dashboard/radar/page.tsx`
- `app/instagram-dashboard/server-check/page.tsx`
- `app/instagram-dashboard/activity-log/page.tsx`
- `lib/instagram-dashboard/defaults.ts`
- `app/api/instagram-dashboard/*/route.ts`
- `docs/instagram-dashboard-admin.md`

Worker/runtime:

- `config.py`
- `account_session_orchestrator.py`
- `dm_sender_engine.py`
- `outreach_session_orchestrator.py`
- `welcome_list_sender.py`
- `unfollow_settings.py`
- `unfollow_session_orchestrator.py`
- `unfollow_eligibility_engine.py`
- `supabase_client.py`
- `runtime_events.py`
- `incident_notifications.py`
- `account_session_resume_engine.py`
- `runner.py`
- `instagram_navigation.py`
- SQL migrations under `supabase/migrations/`
- `docs/dashboard-settings-registry.md`
- `docs/outreach-entry-api.md`
- `docs/project-knowledge-base.md`

## 3. Coverage Statement

Coverage was built from four independent passes:

1. Enumerated every key in frontend `settingsFields`, `filterFields`, `defaultInstagramSettings`, `defaultInstagramFilters`, Add Profile form state, Targets panel state, and dashboard action buttons.
2. Traced every mutating dashboard route under `app/api/instagram-dashboard/*` to payload keys and DB writes.
3. Searched the Python runtime for each legacy and domain setting key, then checked the exact consumer functions where matches exist.
4. Compared against `docs/dashboard-settings-registry.md`, runtime migrations, and current hard caps in `config.py`.

Known limitation: this audit did not query live production DB values. Defaults below are source-code defaults or documented table defaults, not a live environment dump.

## 4. Matrix Summary Counts

| Metric | Count | Notes |
|---|---:|---|
| Legacy settings fields audited | 101 | `ig_account_settings`, excluding `account_id` |
| Legacy filter fields audited | 17 | `ig_account_filters`, excluding `account_id` |
| Dashboard page/action controls audited | 39 | Add Profile, CT, lifecycle, stop, exports, read-only views |
| Total audited rows | 157 | Field/action level |
| Currently visible editable drawer fields | 77 | 60 settings + 17 filters after cleanup |
| Currently read-only drawer fields | 9 | Safe projections/status fields |
| Hidden/removed legacy settings fields | 32 | Includes Device tab, dry-run/send/real-action gates |
| Runtime-proven current dashboard paths | 15 | Mostly CT, Add Profile credential handoff, lifecycle/stop audit |
| Domain semantics proven but dashboard path not wired | 18 | DM/unfollow/follow-private equivalents |
| DB-only legacy settings/filters | 75 | Saved in frontend DB, no direct worker consumer found |
| Ops-only controls | 24 | Device, dry-run, send, real-action gates, incident notifications |
| Dangerous without env gate | 9 | Real DM/follow/unfollow/like/dry-run controls |
| Client-safe candidates | 12 | Read-only projections/templates/CT summaries after proof |
| BotApp-safe candidates | 8 | Same-domain read-only, audit-backed only |

## 5. Full Matrix

Legend:

- `runtime_proven`: current dashboard path writes/reads the runtime source of truth or a directly consumed queue/action.
- `partially_proven`: runtime consumes a domain equivalent, but the current dashboard field writes a legacy table or lacks full caps/audit.
- `db_only`: dashboard saves data but no worker consumer found.
- `legacy_unknown`: inherited setting with unclear runtime role.
- `no_runtime_effect`: UI-only/read-only/export/status display.
- `ops_only`: operational control/config/env only.
- `dangerous_without_env_gate`: real action cannot be safe without env/config hard gate.

### A. General

| UI field / button | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Final classification / recommendation |
|---|---|---|---|---|---|---|---|---|---|
| username | Drawer General | visible editable | `PATCH /settings`, `username` | `ig_account_settings.username`; Add Profile also `ig_accounts.username` | runtime uses account username passed by dispatcher, not legacy settings row | partially_proven for account identity; db_only for drawer edit | UI `""`; prod source should be `ig_accounts`/safe account projection | confusing | keep read-only or move to account identity API |
| display_name | Drawer General | visible editable | `PATCH /settings`, `display_name` | `ig_account_settings.display_name`; Add Profile `ig_accounts.display_name` | not found | db_only | UI `""`; prod source `ig_accounts.display_name` | harmless/confusing | keep read-only later |
| device_name | Drawer General | visible editable | `PATCH /settings`, `device_name` | `ig_account_settings.device_name`; fallback `ig_accounts.device_name` | worker uses device assignment/config, not this legacy field | legacy_unknown | UI `""`; prod source `phone_devices`/assignment | client-visible wrong promise | move ops-only/read-only |
| device_udid | Legacy default | hidden/protected | preserved by `/settings`, not returned | `ig_account_settings.device_udid`, `ig_accounts.device_udid` | device-level config/assignment, not drawer row | ops_only | hidden; no prod UI default | secret/device leak | keep hidden; never client |
| email | Legacy raw field | hidden/protected; Add Profile input visible | Add Profile `email`; `/settings` preserves raw | `ig_account_settings.email` legacy | not found as runtime setting | deprecated | raw hidden; prod via credential/status projection only | secret leak | remove from settings surface |
| password | Legacy raw field | hidden/protected; Add Profile input visible | Add Profile credential API, `/settings` preserves/clears | legacy `ig_account_settings.password` cleared; `account_credentials` via credential service | credential provisioning modules, not legacy settings | runtime_proven for Add Profile credential handoff; deprecated for settings | write-only; no UI default | secret leak | keep Add Profile write-only only |
| email_display | Drawer General | read-only | returned by `/settings` only | derived from email | not found | no_runtime_effect | derived masked display | harmless | keep read-only |
| password_status | Drawer General | read-only | returned by `/settings` only | derived from protected password state | account status/credential status elsewhere | no_runtime_effect | write-only status | confusing if treated as credential truth | keep read-only, prefer credentials projection |
| two_fa_enabled | Drawer General | visible editable | `PATCH /settings`, `two_fa_enabled` | `ig_account_settings.two_fa_enabled` | not found; login status publisher has separate signals | db_only | UI false | client-visible wrong promise | keep read-only or hide until login-status API |
| device_assignment | Drawer General | read-only | returned by `/settings` only | derived from `device_name` | not found | no_runtime_effect | status label only | harmless | keep read-only |
| app_package_status | Drawer General | read-only | returned by `/settings` only | derived/constant hidden | config `INSTAGRAM_PACKAGE`, clone assignment future | no_runtime_effect | hidden | confusing | keep read-only or remove |
| clone_assignment_status | Drawer General | read-only | returned by `/settings` only | derived from `cloned_app_mode` | not found as dashboard setting | no_runtime_effect | hidden/status | confusing | keep read-only |
| app_package | Legacy raw field | hidden/protected | preserved by `/settings` | `ig_account_settings.app_package` | config `INSTAGRAM_PACKAGE` in `config.py` | ops_only | worker default `com.instagram.android` | device instability | keep hidden; clone/domain API later |
| cloned_app_mode | Legacy raw field | hidden/protected | preserved by `/settings`; Add Profile `clone_mode` | `ig_account_settings.cloned_app_mode`; `ig_accounts.clone_mode` | assignment/clone future; no direct setting consumer found | legacy_unknown | UI false | wrong clone promise | move ops-only/domain assignment |
| account_status | Drawer General | read-only | `PATCH /settings` currently includes value if saved | `ig_account_settings.account_status`; lifecycle uses `ig_accounts.status` | status publisher and dashboard actions use separate status axes | partially_proven for account lifecycle, db_only for legacy field | UI `active`; candidate use `admin_status/login_status/provisioning_status` | confusing | keep read-only; use lifecycle route |
| campaign_name | Drawer General | visible editable | `PATCH /settings`, `campaign_name` | `ig_account_settings.campaign_name` | not found | db_only | UI `Default campaign` | wrong product promise | needs product decision; hide from client |
| Save as Template | Drawer action | visible action | `POST /templates`, redacted payload | `ig_account_templates.settings_payload/filters_payload` | no worker consumer | db_only/admin utility | no prod runtime default | reapply legacy fields | keep admin-only with warning |
| Apply Template | Drawer action | visible action | `PATCH /templates/apply`, `template_id/account_id` | upserts `ig_account_settings`/`ig_account_filters` | no direct worker consumer for legacy fields | db_only/dangerous legacy replay | no prod default | confusing, can reintroduce hidden values | keep admin-only; domain-template rewrite required |

### B. Schedule

| UI field | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| timeslot_start | Drawer Schedule | visible editable | `/settings`, `timeslot_start` | `ig_account_settings.timeslot_start` | account assignment dispatch window is config/env, not this field | db_only | UI `09:00`; prod TBD | wrong scheduling promise | hide or wire later via scheduler policy |
| timeslot_end | Drawer Schedule | visible editable | `/settings`, `timeslot_end` | `ig_account_settings.timeslot_end` | not found | db_only | UI `18:00`; prod TBD | wrong scheduling promise | hide or wire later |
| total_sessions | Drawer Schedule | visible editable | `/settings`, `total_sessions` | legacy settings | not found | db_only | UI 1 | quota promise | needs runtime proof |
| stop_interactions_after_minutes | Drawer Schedule | visible editable | `/settings` | legacy settings | config has independent session limits such as `UNFOLLOW_SESSION_MAX_MINUTES`; no direct consumer | legacy_unknown | UI 45; worker domain-specific env | wrong safety promise | hide until domain caps exist |
| timeout_startup_seconds | Cleanup hidden | hidden | legacy `/settings` default only | legacy settings | provisioner has CLI/config timeouts, not this field | ops_only | UI default 120 | device instability | keep hidden |
| pause_account_days | Drawer Schedule | visible editable | `/settings` | legacy settings | lifecycle route uses immediate archive/trash/restore; no pause consumer | db_only | UI 0 | wrong pause promise | wire later via dashboard action |
| pause_account_until | Drawer Schedule | visible editable | `/settings` | legacy settings | not found | db_only | UI empty | wrong pause promise | wire later via dashboard action |
| randomize_start_enabled | Drawer Schedule | visible editable | `/settings` | legacy settings | not found | db_only | UI true | harmless/confusing | hide until scheduler proof |
| speed_multiplier | Cleanup hidden | hidden | legacy `/settings` default only | legacy settings | runtime pacing constants in `config.py`, no direct consumer | ops_only | UI 1 | too many actions/device instability | keep hidden |

### C. Actions

| UI field | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| follow_enabled | Cleanup hidden | hidden | legacy `/settings` default only | `ig_account_settings.follow_enabled` | follow runtime gates are config constants (`ENABLE_REAL_FOLLOW`, `ENABLE_REAL_VISUAL_FOLLOW`) and dispatcher flow | dangerous_without_env_gate | UI false; worker config currently independent | follow destructive | keep hidden; wire only via domain API + env cap |
| follow_limit | Drawer Actions | visible editable | `/settings`, `follow_limit` | legacy settings | config `FOLLOW_MAX_PER_RUN`, `FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN`; no legacy DB consumer | db_only | UI 20; worker `FOLLOW_MAX_PER_RUN=2` | quota overrun promise | needs runtime proof; candidate prod from package matrix only |
| total_follows_limit | Drawer Actions | visible editable | `/settings`, `total_follows_limit` | legacy settings | config `SESSION_TOTAL_FOLLOWS_CAP=0`; no legacy DB consumer | db_only | UI 100; worker disabled/independent | quota overrun | wire later with `min(package, DB, env)` |
| follow_percentage | Cleanup hidden | hidden | legacy default | legacy settings | not found | deprecated | UI 100 | confusing | remove from UI |
| unfollow_enabled | Cleanup hidden | hidden | legacy default | legacy settings | domain equivalent `ig_account_unfollow_settings.unfollow_enabled` read by `unfollow_settings.load_unfollow_settings` | partially_proven, current path db_only | UI false; domain default false | unfollow destructive | keep hidden until domain API |
| total_unfollows_limit | Drawer Actions | visible editable | `/settings` | legacy settings | domain equivalent `unfollow_per_day_limit` read by `unfollow_session_orchestrator` | partially_proven, current path db_only | UI 0; domain default 200; env hard per-run 1..10 | unfollow destructive | hide or wire to domain API |
| unfollow_delay_days | Drawer Actions | visible editable | `/settings` | legacy settings | domain equivalent `unfollow_after_days` read by `unfollow_settings.py` | partially_proven, current path db_only | UI 7; domain default 3 | destructive timing | wire later via domain API |
| like_enabled | Cleanup hidden | hidden | legacy default | legacy settings | post-follow like config constants, no legacy consumer | dangerous_without_env_gate | UI false; worker independent | action spam | keep hidden |
| total_likes_limit | Drawer Actions | visible editable | `/settings` | legacy settings | config `POST_FOLLOW_TOTAL_LIKES_LIMIT`, no legacy DB consumer | db_only | UI 100; worker 150 | wrong quota promise | hide until post-follow domain API |
| likes_per_follow_min | Drawer Actions | visible editable | `/settings` | legacy settings | post-follow config/flow, no legacy DB consumer | db_only | UI 0 | action spam promise | hide or needs proof |
| likes_per_follow_max | Drawer Actions | visible editable | `/settings` | legacy settings | post-follow config/flow, no legacy DB consumer | db_only | UI 2 | action spam promise | hide or needs proof |
| likes_percentage | Cleanup hidden | hidden | legacy default | legacy settings | not found | deprecated | UI 100 | confusing | remove from UI |
| story_watch_enabled | Cleanup hidden | hidden | legacy default | legacy settings | not found as active runtime setting | legacy_unknown | UI true, safe setup false | wrong promise | keep hidden |
| watch_photo_time_min | Cleanup hidden | hidden | legacy default | legacy settings | not found | legacy_unknown | UI 3 | device pacing confusion | remove from UI |
| watch_photo_time_max | Cleanup hidden | hidden | legacy default | legacy settings | not found | legacy_unknown | UI 8 | device pacing confusion | remove from UI |
| watch_video_time_min | Cleanup hidden | hidden | legacy default | legacy settings | not found | legacy_unknown | UI 5 | device pacing confusion | remove from UI |
| watch_video_time_max | Cleanup hidden | hidden | legacy default | legacy settings | not found | legacy_unknown | UI 18 | device pacing confusion | remove from UI |

### D. DM

| UI field | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| welcome_dm_enabled | Drawer DM | visible editable | `/settings` | legacy settings | domain equivalent `ig_account_dm_settings.welcome_enabled` read in `account_session_orchestrator.run_account_session` | partially_proven, current path db_only | UI true; domain ensure default false | DM spam/wrong promise | wire later via DM domain API |
| welcome_dm_message | Drawer DM | visible editable | `/settings` | legacy settings | runtime sends jobs/templates from DM job/template domain, not legacy field | partially_proven, current path db_only | UI empty | content/audit risk | move to versioned template API |
| cold_dm_enabled | Drawer DM | visible editable | `/settings` | legacy settings | domain equivalent `ig_account_dm_settings.outreach_enabled` read in `outreach_session_orchestrator` | partially_proven, current path db_only | UI false; domain default false | DM spam | wire via DM domain API |
| cold_dm_message | Drawer DM | visible editable | `/settings` | legacy settings | runtime outreach jobs/templates, not legacy field | partially_proven, current path db_only | UI empty | content/audit risk | move to versioned template API |
| max_dm_per_run | Drawer DM | visible editable | `/settings` | legacy settings | domain equivalents `welcome_per_session_limit`, `outreach_per_session_limit`; hard caps in config | partially_proven, current path db_only | UI 2; safe setup 1; worker hard outreach 5/session | DM spam | wire with hard cap |
| max_consecutive_dms | Drawer DM | visible editable | `/settings` | legacy settings | not found | db_only | UI 3 | wrong pacing promise | hide until proof |
| check_chat_before_welcoming | Drawer DM | visible editable | `/settings` | legacy settings | domain equivalent `check_chat_before_welcome` read by `dm_sender_engine._evaluate_welcome_sendability` | partially_proven, current path db_only | UI true; worker default true | duplicate DM risk | wire via DM domain API |
| send_enabled | Cleanup hidden | hidden | legacy default | legacy settings | real gate is env/config `DM_SENDER_REAL_SEND_ENABLED` in `_resolve_dm_sender_real_send_enabled` | dangerous_without_env_gate | UI false; worker default false unless env true | DM spam | keep ops-only/env only |
| safe_review_mode | Drawer DM | visible editable | `/settings` | legacy settings | not found | db_only | UI true | false safety promise | hide or make read-only label |
| real send gates | Runtime config | ops-only | env/config only | none from UI | `dm_sender_engine._resolve_dm_sender_real_send_enabled` | runtime_proven ops gate | default false | DM spam | never client-editable |

### E. Followback / Unfollow

| UI field | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| followback_on_followers | Drawer Followback | visible editable | `/settings` | legacy settings | not found | legacy_unknown | UI false | confusing | hide until dynamic followback proof |
| max_followback_skips | Drawer Followback | visible editable | `/settings` | legacy settings | account session has follow-to-unfollow diagnostics, no direct consumer | legacy_unknown | UI 50 | confusing | hide or needs proof |
| max_followback_ignore | Drawer Followback | visible editable | `/settings` | legacy settings | not found | legacy_unknown | UI 200 | confusing | hide |
| sort_followers_mode | Drawer Followback | visible editable | `/settings` | legacy settings | not found; unfollow has separate `unfollow_sort_mode` domain | legacy_unknown | UI `recent` | wrong promise | hide or map domain explicitly |
| unfollow_non_followers | Drawer Followback | visible editable | `/settings` | legacy settings | domain equivalent maps to `ig_account_unfollow_settings.unfollow_mode` | partially_proven, current path db_only | UI false; domain default `unfollow` | unfollow destructive | hide until domain API |
| unfollow_any | Drawer Followback | visible editable | `/settings` | legacy settings | domain equivalent `unfollow_mode=unfollow-any`; real action gated by env + settings | partially_proven/dangerous | UI false; real env false by default | unfollow destructive | move ops-only/domain API |
| unfollow_skip_limit | Drawer Followback | visible editable | `/settings` | legacy settings | domain/session caps exist but no direct legacy consumer | partially_proven, current path db_only | UI 50 | destructive quota | wire to domain only |
| mute_posts_after_follow | Drawer Followback | visible editable | `/settings` | legacy settings | visual mute flow config, no direct legacy consumer | legacy_unknown | UI false | account behavior surprise | move ops-only |
| mute_stories_after_follow | Drawer Followback | visible editable | `/settings` | legacy settings | visual mute flow config, no direct legacy consumer | legacy_unknown | UI false | account behavior surprise | move ops-only |
| do_follows_first | Drawer Followback | visible editable | `/settings` | legacy settings | domain unfollow has `do_unfollow_first`; no direct legacy consumer | legacy_unknown | UI true | wrong order promise | hide |

### F. Sources

| UI field | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| source_accounts | Cleanup hidden | hidden | legacy default/template redacted from saved templates | legacy settings | source truth should be `ig_targets`; no direct consumer found | deprecated | UI empty | CT/source divergence | remove from UI and templates |
| truncate_sources_min | Drawer Sources | visible editable | `/settings` | legacy settings | not found | db_only | UI 20 | wrong source policy | hide |
| truncate_sources_max | Drawer Sources | visible editable | `/settings` | legacy settings | not found | db_only | UI 80 | wrong source policy | hide |
| delete_interacted_users | Drawer Sources | visible editable | `/settings` | legacy settings | social memory uses `ig_interacted_users`; no legacy delete setting consumer | ops_only/db_only | UI false | data loss | move ops-only/never client |
| change_source_if_crash | Drawer Sources | visible editable | `/settings` | legacy settings | recovery config/logs exist, no direct consumer | legacy_unknown | UI true | source drift | hide |
| skipped_posts_limit | Drawer Sources | visible editable | `/settings` | legacy settings | not found | db_only | UI 20 | confusing | hide |
| fling_when_skipped | Drawer Sources | visible editable | `/settings` | legacy settings | navigation heuristics exist, no direct consumer | ops_only/legacy_unknown | UI true | device instability | move ops-only |

### G. Filters

All rows below call `PATCH /api/instagram-dashboard/filters` and save to `ig_account_filters`. No direct Python consumer of `ig_account_filters` was found. The private-profile toggle conflicts semantically with domain `ig_account_follow_settings.dont_follow_private_accounts`.

| UI field | Current state | DB column | Worker consumer | Proof / effect | Default | Risk | Recommendation |
|---|---|---|---|---|---|---|---|
| disable_filters | visible editable | `disable_filters` | not found | db_only | false | wrong filtering promise | hide until filter engine proof |
| skip_followers | visible editable | `skip_followers` | not found | db_only | true | client-visible wrong promise | client-safe later only after proof |
| skip_following | visible editable | `skip_following` | not found | db_only | true | client-visible wrong promise | client-safe later only after proof |
| skip_business_profiles | visible editable | `skip_business_profiles` | not found | db_only | false | targeting mismatch | needs proof |
| skip_non_business_profiles | visible editable | `skip_non_business_profiles` | not found | db_only | false | targeting mismatch | needs proof |
| follow_private_profiles | visible editable | `follow_private_profiles` | domain inverse `dont_follow_private_accounts` | partially_proven, current path db_only | false | semantic inversion | hide until reconciled |
| follow_only_private_profiles | visible editable | `follow_only_private_profiles` | not found | db_only | false | destructive targeting | hide |
| dm_private_profiles | visible editable | `dm_private_profiles` | not found | db_only | false | DM eligibility mismatch | hide |
| min_followers | visible editable | `min_followers` | not found | db_only | 1 | wrong eligibility promise | client-safe later after proof |
| max_followers | visible editable | `max_followers` | not found | db_only | 1000000000000 | wrong eligibility promise | client-safe later after proof |
| min_following | visible editable | `min_following` | not found | db_only | 1 | wrong eligibility promise | client-safe later after proof |
| max_following | visible editable | `max_following` | not found | db_only | 1000000000000 | wrong eligibility promise | client-safe later after proof |
| min_posts | visible editable | `min_posts` | not found | db_only | 1 | wrong eligibility promise | client-safe later after proof |
| blacklisted_words | visible editable | `blacklisted_words` | not found | db_only | empty | moderation mismatch | admin-only until filter API |
| mandatory_words | visible editable | `mandatory_words` | not found | db_only | empty | moderation mismatch | admin-only until filter API |
| whitelist_words | visible editable | `whitelist_words` | not found | db_only | empty | moderation mismatch | admin-only until filter API |
| blacklist_accounts | visible editable | `blacklist_accounts` | not found | db_only | empty | target exclusion mismatch | admin-only until filter API |

### H. Safety

| UI field | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| dry_run_enabled | Cleanup hidden | hidden | legacy default | legacy settings | runtime dry-run gates are env/config per module, not this field | dangerous_without_env_gate | UI true; many worker dry-run gates independent | false safety promise | keep hidden ops-only |
| total_interactions_limit | Drawer Safety | visible editable | `/settings` | legacy settings | config `SESSION_TOTAL_INTERACTIONS_LIMIT=0`; no legacy consumer | db_only | UI 120 | quota promise | needs runtime proof |
| total_successful_interactions_limit | Drawer Safety | visible editable | `/settings` | legacy settings | config `SESSION_TOTAL_SUCCESSFUL_INTERACTIONS_LIMIT=0`; no legacy consumer | db_only | UI 80 | quota promise | needs proof |
| interactions_count | Drawer Safety | visible editable | `/settings` | legacy settings | runtime counters/logs separate | db_only/deprecated | UI 0 | counter corruption | make read-only/remove |
| interact_percentage | Cleanup hidden | hidden | legacy default | legacy settings | not found | deprecated | UI 100 | confusing | remove |
| end_if_follow_limit_reached | Drawer Safety | visible editable | `/settings` | legacy settings | no direct consumer | db_only | true | false stop promise | hide |
| end_if_dm_limit_reached | Drawer Safety | visible editable | `/settings` | legacy settings | no direct consumer | db_only | true | false stop promise | hide |
| end_if_likes_limit_reached | Drawer Safety | visible editable | `/settings` | legacy settings | no direct consumer | db_only | true | false stop promise | hide |
| max_actions_per_hour | Drawer Safety | visible editable | `/settings` | legacy settings | no direct consumer | db_only | 30 | quota promise | wire later with package/env caps |
| max_actions_per_day | Drawer Safety | visible editable | `/settings` | legacy settings | no direct consumer | db_only | 120 | quota promise | wire later with package/env caps |
| random_delay_min_seconds | Drawer Safety | visible editable | `/settings` | legacy settings | module-specific config timings, no legacy consumer | db_only | 8 | pacing promise | hide or domain pacing API |
| random_delay_max_seconds | Drawer Safety | visible editable | `/settings` | legacy settings | module-specific config timings, no legacy consumer | db_only | 20 | pacing promise | hide or domain pacing API |
| random_pause_every_actions | Cleanup hidden | hidden | legacy default | legacy settings | not found | ops_only | 15 | pacing/device instability | keep hidden |
| long_break_after_interactions | Cleanup hidden | hidden | legacy default | legacy settings | not found | ops_only | 45 | pacing/device instability | keep hidden |
| long_break_min_minutes | Cleanup hidden | hidden | legacy default | legacy settings | not found | ops_only | 8 | pacing/device instability | keep hidden |
| long_break_max_minutes | Cleanup hidden | hidden | legacy default | legacy settings | not found | ops_only | 18 | pacing/device instability | keep hidden |
| warmup_mode | Drawer Safety | visible editable | `/settings` | legacy settings | warm-session config exists, no direct consumer | legacy_unknown | true | false promise | hide until proof |
| stop_on_suspicious_screen | Drawer Safety | visible editable | `/settings` | legacy settings | recovery/incidents config exists, no direct consumer | legacy_unknown | true | false safety promise | hide |
| stop_on_login_challenge | Drawer Safety | visible editable | `/settings` | legacy settings | login/challenge runtime events separate | legacy_unknown | true | false safety promise | hide |
| stop_on_checkpoint | Drawer Safety | visible editable | `/settings` | legacy settings | checkpoint detection separate | legacy_unknown | true | false safety promise | hide |
| stop_on_repeated_navigation_failure | Drawer Safety | visible editable | `/settings` | legacy settings | recovery engine constants separate | legacy_unknown | true | false safety promise | hide |
| max_repeated_errors | Drawer Safety | visible editable | `/settings` | legacy settings | recovery constants separate | legacy_unknown | 5 | false safety promise | move ops-only |

### I. Advanced and Hidden Ops

| UI field | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| current_run_status | Drawer Advanced | read-only | `/settings` | legacy settings | runtime uses `ig_runs`, `runtime_events`; not this field | no_runtime_effect/db_only if saved | UI `idle` | wrong run status promise | keep read-only or remove |
| last_error | Drawer Advanced | read-only | `/settings` | legacy settings | incidents/logs separate | no_runtime_effect/db_only if saved | empty | wrong incident promise | keep read-only or remove |
| last_successful_action | Drawer Advanced | visible editable | `/settings` | legacy settings | action logs separate | db_only | empty | audit confusion | make read-only/remove |
| manual_stop_requested | Drawer Advanced | read-only | `/settings` | legacy settings | stop route updates `ig_runs`; no worker poll found | no_runtime_effect/db_only | false | false stop promise | keep read-only; use Stop run action |
| disable_block_detection | Cleanup hidden Device tab | hidden | legacy default | legacy settings | not found | ops_only | false | account safety | keep hidden |
| relog_after_block | Cleanup hidden Device tab | hidden | legacy default | legacy settings | recovery config separate | ops_only | true | account safety | keep hidden |
| relog_delay_seconds | Cleanup hidden Device tab | hidden | legacy default | legacy settings | not found | ops_only | 120 | device instability | keep hidden |
| rotate_ip | Cleanup hidden Device tab | hidden | legacy default | legacy settings | not found | ops_only | false | network risk | keep hidden |
| restart_uiautomator2 | Cleanup hidden Device tab | hidden | legacy default | legacy settings | device ops scripts/config only | ops_only | true | device instability | keep hidden |
| close_apps | Cleanup hidden Device tab | hidden | legacy default | legacy settings | device config/runner actions separate | ops_only | true | device instability | keep hidden |
| close_apps_device | Cleanup hidden Device tab | hidden | legacy default | legacy settings | not found | ops_only | false | device instability | keep hidden |
| log_out_all_before_session | Cleanup hidden Device tab | hidden | legacy default | legacy settings | login provisioner/logout flows separate | ops_only | false | destructive account state | keep hidden |
| total_crashes_limit | Cleanup hidden Device tab | hidden | legacy default | legacy settings | recovery constants separate | ops_only | 3 | false safety promise | keep hidden |
| screen_sleep | Cleanup hidden Device tab | hidden | legacy default | legacy settings | not found | ops_only | false | device instability | keep hidden |
| screen_record | Cleanup hidden Device tab | hidden | legacy default | legacy settings | not found | ops_only | false | privacy/device | keep hidden |
| debug_mode | Cleanup hidden Device tab | hidden | legacy default | legacy settings | config/debug flags separate | ops_only | false | raw metadata leak | keep hidden |

### J. CT / Targets

| UI field / button | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| Add target simple | Targets modal | visible editable | `POST /targets`, `account_id,target_username,followers_count?` | `ig_targets`, `ct_target_audit_events`; may enqueue job | CT verification processor and source quality path; direct follow runtime DB consumption not proven in Python search | runtime_proven for CT DB/verification; partially_proven for follow source | guard min/max followers in target quality | duplicate/quality drift | keep visible |
| Bulk import | Targets modal | visible editable | `POST /targets`, `usernames[]` | `ig_targets`, `ct_target_verification_jobs`, audit | CT verification processor | runtime_proven for verification queue | unique duplicate classification; job upsert on target_id | duplicates/backpressure | keep visible |
| Reset target | Targets modal | visible action | `PATCH /targets/reset`, `ids[]` | `ig_targets` status fields, audit | CT verification state | runtime_proven for CT state | no prod default | reset vs restore confusion | keep visible with copy |
| Archive/delete soft | Targets modal | visible action | `DELETE /targets`, `ids[]` | `ig_targets.status=archived`, audit | CT source state | runtime_proven for dashboard source | no hard delete | source loss if misused | keep visible with confirmation |
| Restore/unarchive | Targets modal | visible action | `PATCH /targets`, `id, action=restore` | `ig_targets`, maybe `ct_target_verification_jobs` | CT verification queue | runtime_proven | duplicate-active guard | stale quality | keep visible |
| Eligibility | Targets table | visible read-only | GET `/targets` | `ig_targets.quality_status/status` | CT processor | runtime_proven for CT quality | n/a | wrong client promise if confused with FBR | keep read-only |
| Perf | Targets table | visible read-only | GET `/targets` + data mapper | aggregates/projection | performance/FBR future | partially_proven | n/a | followers_count vs FBR confusion | keep read-only |
| FBR | Targets table | visible read-only | GET `/targets` | `followback_ratio` when present | FBR runtime not fully traced | partially_proven | n/a | metric confusion | keep read-only |
| Verify batch | API route | hidden/admin API | `POST /targets/verify-batch` | claims/updates `ct_target_verification_jobs`, `ig_targets` | `processTargetVerificationBatch` | runtime_proven for CT verification | caller limit/max duration | provider quota | ops/admin only |
| Verify cron | API route | hidden/cron | `GET/POST /targets/verify-cron`, token header/query | scheduler lock + job queue | cron helper/processor | runtime_proven ops | env enabled/token/limit/dry-run | quota/concurrency | ops-only env, no UI |
| Activity Log target audit | Activity Log | visible read-only | page/data reads audit/log projections | `ct_target_audit_events`/logs | audit only | runtime_proven audit | n/a | none if redacted | keep visible |

### K. Credentials / Add Profile

| UI field / button | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| Add Profile | Manage wizard | visible action | `POST /accounts/create` | `ig_accounts`, `ig_account_settings`, `ig_account_filters`, audit; credential service creates credential state | login provisioner consumes account/credentials pipeline, not legacy password | runtime_proven for credential handoff/account creation | safe setup sets dry-run true in legacy only; credential API timeout 9s | duplicate/credential failure | keep visible admin-only |
| Instagram username | Add Profile | visible editable | `username` | `ig_accounts.username` | account identity | runtime_proven | provider lookup required | duplicate/wrong account | keep |
| Password input | Add Profile | visible write-only | credential API payload | credential service/account credentials; legacy settings password cleared | credential runtime/provisioner | runtime_proven write-only | no stored UI default | secret leak | keep write-only no display |
| Email optional | Add Profile | visible editable | `email` | legacy settings email | not runtime setting | db_only/deprecated | empty | secret-ish PII | consider removing unless needed |
| Device selection | Add Profile | visible editable | `device_id/device_name` | `ig_accounts.device_id/device_name/device_udid` | assignment dispatcher future/config | partially_proven | first device fallback | wrong assignment | keep admin-only |
| Clone mode | Add Profile | visible editable | `clone_mode` | `ig_accounts.clone_mode`, `ig_account_settings.cloned_app_mode` | clone assignment future | legacy_unknown | default off | wrong clone promise | keep admin-only until assignment API |
| Template mode/id | Add Profile | visible editable | `template_mode/template_id` | applies redacted template payload to settings/filters | no runtime consumer for legacy settings | db_only utility | default safe setup | reintroduce legacy fields | keep admin-only; domain template later |
| SearchApi/public lookup | Add Profile API | hidden server-side | provider env/config only | verification fields in `ig_accounts` | not worker; account verification | runtime_proven for Add Profile validation | server-only provider, no key client | quota/backpressure | keep server-only |
| Credentials Actions list | Credentials page | visible read-only/actions pending | page data/status | `account_dashboard_actions`, `account_credentials` projections | credential status sync RPCs | partially_proven | no secrets | client-visible wrong promise | keep pending badges honest |
| Request/update credential action | Credentials page | pending/disabled where present | not active in current page | dashboard action future | credential service future | no_runtime_effect/pending_backend | n/a | secret flow | keep disabled until secure link |
| Vault/secret_ref | Not displayed | hidden | none in UI | credential storage only | credential runtime | ops_only/secret | no UI default | secret leak | never display |

### L. Devices / Ops

| UI field / button | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| Devices inventory | Devices page | visible read-only | page data + `/devices` for wizard | `ig_devices`, derived Radar/manage data | device assignment future | no_runtime_effect/read-only | n/a | internal leak if expanded | keep read-only safe projection |
| Restart phone | Devices/ops | not visible as active control | none | none | device scripts/config future | no_runtime_effect | n/a | device instability | ops-only later with audit |
| Stop/start all accounts | Ops | not found active | none | none | not found | no_runtime_effect | n/a | destructive | not until action queue |
| Device health | Devices/Radar/Server Check | visible read-only | page data | Radar/manage projections | runtime events/heartbeats future | partially_proven read-only | n/a | false health promise | keep read-only |
| ATX/AtxAgent references | Docs/ops only | not active UI | none | none | not found active setting | ops_only | n/a | device instability | docs/ops only |
| update lock / Instagram version lock | Worker config/docs | not UI | config only | local lock state/logs | `README`, update lock routines | ops_only/runtime_proven config | strict lock config/env | device blocked | keep out of dashboard standard |
| Play Store lock | Worker config/docs | not UI | config only | none | update lock routines | ops_only | config/env | device ops risk | ops-only |
| close apps/home after run | Cleanup hidden legacy | hidden | legacy default | legacy settings | runner/device actions separate | ops_only | UI true | device instability | keep hidden |
| device serial / UDID | Hidden | hidden | no client display | device tables/legacy | config `DEVICE_SERIAL`, assignments | ops_only | none | secret/device leak | never client |

### M. Notifications / Incidents

| UI field / button | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| Radar badges | Nav/Radar | visible read-only | page data | derived warnings/incidents/logs | `runtime_events`, `account_incidents` future | partially_proven read-only | n/a | false severity promise | keep read-only |
| Server Check worklist | Server Check | visible read-only | page data | derived status | runtime projections future | partially_proven read-only | n/a | ops confusion | keep read-only |
| Slack enabled | Not dashboard UI | hidden config | none | `account_incident_notifications` audit | `incident_notifications.py`, config `INCIDENT_NOTIFICATIONS_SLACK_ENABLED` | ops_only/runtime_proven dispatcher | config default true but dispatcher disabled/dry-run by default | webhook leak | keep env-only |
| Discord enabled | Not dashboard UI | hidden config | none | notification audit | `incident_notifications.py`, config `INCIDENT_NOTIFICATIONS_DISCORD_ENABLED` | ops_only/runtime_proven dispatcher | config default true but dispatcher disabled/dry-run by default | webhook leak | keep env-only |
| Incident min severity | Not dashboard UI | hidden config | none | notification audit | `incident_notifications.py` | ops_only/runtime_proven dispatcher | config `warning` | noisy alerts | env-only |
| Notification cooldown/max | Not dashboard UI | hidden config | none | notification audit | `incident_notifications.py` | ops_only/runtime_proven dispatcher | max 20/run, cooldown 60m | spam | env-only |
| Runtime events | Radar/Admin overview | read-only projection | no dashboard mutation | `runtime_events`, heartbeats | `runtime_events.py` opt-in fail-open | partially_proven | disabled by default | false health promise | keep read-only until source is authoritative |
| Account incidents | Radar/Admin overview | read-only projection | no dashboard mutation | `account_incidents`, actions RPCs | incident modules opt-in | partially_proven | disabled/fail-open by default | false incident promise | keep read-only |

### N. Session / Package / Quotas

| Control / concept | Surface | Current state | API / payload | DB touched | Worker consumer | Proof / effect | Defaults / caps / candidate prod | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| session 6h window | Growth/roadmap concept | not active setting | none | none | not found as dashboard setting | no_runtime_effect | TBD | pricing promise | define in Prod Defaults Freeze later |
| day limits | Growth/settings display | visible read-only/legacy editable fields | legacy `/settings` | legacy settings | domain-specific counters for DM/unfollow only | partially_proven by domain, not dashboard | TBD package matrix | quota overrun | matrix before defaults |
| 80/80 package | Roadmap/package display | read-only package labels | Manage data | subscription/account projections | not runtime quota policy | no_runtime_effect | unknown | pricing mismatch | pricing-ready later |
| 120/120 package | Roadmap/package display | read-only package labels | Manage data | subscription/account projections | not runtime quota policy | no_runtime_effect | unknown | pricing mismatch | pricing-ready later |
| phone rest logic | Ops concept | not active UI | none | none | not found as dashboard setting | no_runtime_effect | TBD | device overuse | define ops scheduler |
| auto-restart | Worker config | hidden/ops | config/env only | none | `account_session_orchestrator`, `account_session_resume_engine` | ops_only/partially_proven | env/config defaults; dry-run probes present | loop risk | ops-only |
| resume | Worker/runtime | hidden/read-only summaries | none | runtime summaries | `account_session_resume_engine` | partially_proven | not dashboard-editable | false completion promise | keep read-only |
| strict phase completion | Worker config | hidden | config only | none | `SESSION_STRICT_PHASE_COMPLETION` | ops_only | false | aborted sessions | env-only |
| package entitlements | Growth/Client Accounts | read-only | Manage/Admin overview | subscription/account projections | not runtime quota source | no_runtime_effect | unknown | pricing mismatch | pricing-ready later |

## 6. High-Risk Controls

- `dry_run_enabled`, `send_enabled`, `follow_enabled`, `unfollow_enabled`, `like_enabled`: hidden after cleanup; must remain ops-only/domain-gated.
- `Apply Template`: can reapply legacy payloads to `ig_account_settings`/`ig_account_filters`.
- `unfollow_any`, `unfollow_non_followers`, `total_unfollows_limit`, `unfollow_delay_days`: UI path is legacy; real runtime uses `ig_account_unfollow_settings`.
- DM enabled/template fields: UI path is legacy; real runtime uses `ig_account_dm_settings` and DM jobs/templates.
- Filters: visible and editable but no direct worker consumer found.
- Logs export: current code redacts JSON metadata but TXT exports performance summary; keep no raw metadata/XML/payload guard.
- Add Profile password input: safe only because it is write-only and passed to credentials API; never display or store in UI docs/logs.

## 7. Controls Safe to Keep Visible

- CT Add/Bulk/Reset/Archive/Restore with confirmations and duplicate checks.
- CT Eligibility/Perf/FBR as read-only, with copy preserving FBR distinction.
- Add Profile admin wizard with write-only credential handling.
- Account Detail, Devices, Radar, Server Check, Activity Log as read-only safe projections.
- Credentials Actions and Client Accounts pending states, provided disabled/pending badges remain honest.
- Permanent delete disabled.

## 8. Controls to Keep Read-Only

- `email_display`, `password_status`, `device_assignment`, `app_package_status`, `clone_assignment_status`.
- `account_status` until status axes are separated.
- `current_run_status`, `last_error`, `manual_stop_requested`.
- Growth Settings projection until runtime proof is complete.
- DM Templates page until account-scoped template API and audit exist.
- Device health / phone inventory projections.

## 9. Controls to Hide or Remove

- `source_accounts`, all percentage knobs, story watch fields, long break/random pause fields.
- `interactions_count`, `last_successful_action` as editable fields.
- All filters from client-facing surfaces until runtime proof.
- `safe_review_mode` if kept as a toggle rather than an explanatory label.
- Legacy device fields and clone package internals from standard drawer.

## 10. Controls to Move Ops-Only

- Device tab controls.
- Real-send gates and dry-run gates.
- Unfollow real-action controls.
- Incident notification channel/severity/cooldown.
- Update lock / Play Store lock / Instagram version lock.
- Session strict completion, auto-restart, resume tuning.

## 11. Runtime-Proven Controls

Current dashboard path is runtime/source-of-truth proven for:

- Add Profile secure credential handoff and account creation.
- CT target insert/bulk/reset/archive/restore and CT verification queue.
- CT verify batch/cron as ops-only route.
- Lifecycle archive/trash/restore on `ig_accounts.status`.
- Stop run as dashboard mutation of `ig_runs` plus `ig_action_logs` audit.
- Incident notification dispatcher config, but not dashboard-editable.

## 12. Partially-Proven Controls

Runtime semantics exist, but dashboard writes the wrong table or lacks a domain API:

- DM enable/message/limits/check-chat fields.
- Unfollow enable/mode/delay/day/session limits.
- Follow private-profile behavior.
- Post-follow mute/likes.
- Device health and runtime events as projections.
- Package/day limits as concepts without package-enforced runtime policy.

## 13. Settings That Need Runtime Proof

All visible editable legacy drawer settings should be considered not prod-ready until one of these happens:

- Field is removed/hidden.
- Field is made read-only projection.
- Field writes a domain table through an audited API.
- Worker reads that domain table in the relevant module.
- Effective value is proven in logs/tests with `min(DB, package, env hard cap)`.

Highest priority proof gaps:

1. Follow limits and real follow enablement.
2. DM legacy fields to `ig_account_dm_settings`/templates.
3. Unfollow legacy fields to `ig_account_unfollow_settings`.
4. Filters to actual profile eligibility engine.
5. Package entitlements to runtime caps.

## 14. Candidate Prod Defaults

These are candidates only; do not change them in this phase.

| Domain | Candidate prod default | Hard cap / kill switch |
|---|---|---|
| DM real send | disabled unless explicit env gate + account domain setting | `DM_SENDER_REAL_SEND_ENABLED=false` |
| Welcome DM | disabled until template approved and domain row enabled | `ig_account_dm_settings.welcome_enabled=false` |
| Outreach DM | disabled until outreach campaign/domain row enabled | `ig_account_dm_settings.outreach_enabled=false` |
| Unfollow real action | disabled by env and account setting | `UNFOLLOW_SESSION_REAL_ACTION_ENABLED=false`, max per run capped |
| Follow real action | package/domain gated; no legacy field | follow env/config hard caps |
| CT verification cron | enabled only with token/env/limit/backpressure | cron token + scheduler lock + queue |
| Filters | read-only/no client edit until worker proof | none yet |
| Incident notifications | dry-run by default | `INCIDENT_NOTIFICATIONS_DRY_RUN=true` |

## 15. Defaults Not to Change Yet

- `defaultInstagramSettings` and `defaultInstagramFilters`.
- `config.py` constants.
- Supabase env/Vercel env.
- Package numbers (`80/80`, `120/120`, session windows, phone rest).
- CT cron env.
- SearchApi provider/env.
- Worker DM/follow/unfollow hard caps.

## 16. Required Next Patches

1. **Settings API domain split**: create small audited APIs for DM settings, unfollow settings, follow private-profile settings, and template approvals.
2. **Legacy drawer reduction**: hide remaining db-only fields or convert to read-only audit projections.
3. **Effective limit telemetry**: log and display effective caps as `min(package, DB, env hard cap, day remaining)`.
4. **Filter runtime proof**: decide whether `ig_account_filters` is retained or replaced by a domain eligibility policy.
5. **Package policy**: define Starter/Pro/Premium, `80/80`, `120/120`, session/day caps and phone rest source of truth.
6. **Action audit**: move stop/lifecycle/template application into `account_dashboard_actions` or equivalent audited action API.
7. **BotApp/client sync**: expose only domain-backed read-only settings first.

## 17. No-Leak Confirmation

This report intentionally does not include:

- API keys
- SearchApi key
- cron token
- service role value
- complete Authorization headers
- cookies/session
- passwords
- full `secret_ref`
- Vault UUIDs
- raw provider responses
- raw metadata
- env secret values
- webhook URLs

Secret-like names are mentioned only as redaction categories or field names.

## 18. GO / NO-GO

**NO-GO for Prod Run Defaults Freeze.**

Reason: The dashboard still has many visible editable legacy fields whose values are saved in DB but not read by the runtime. Freezing prod defaults now would create false confidence and potential pricing/runtime divergence.

**GO for next block:** a targeted **Settings API domain wiring plan** or a second cleanup that hides/makes read-only the remaining db-only fields before any prod defaults are frozen.
