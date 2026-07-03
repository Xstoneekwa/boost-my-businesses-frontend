# Per-account commercial plan change

## Model

- **Scope**: each plan change targets exactly one `ig_accounts.id` via a consumed `client_account_entitlements` row (`account_id` set, `status = entitlement_consumed`).
- **Quotes**: `commercial_plan_change_quotes.change_scope = per_account`, `account_id`, `target_outreach_addon_key`, immutable `pricing_snapshot`, `source_revision` via `commercial_plan_change_source_revision_for_account_source`.
- **Credits**: `client_credit_ledger.account_id` scopes usable balance. Legacy rows with `account_id IS NULL` are preserved and **never** consumed by new per-account flows (`account_scoped_credit_balance_cents`).
- **Activation RPC**: `activate_commercial_plan_change_per_account` cancels only the source entitlement for account A, creates a new consumed entitlement on A, writes account-scoped ledger entries, updates `account_commercial_packages` for A only, bumps `account_commercial_policy_revisions`.
- **Legacy**: workspace-wide quotes (`change_scope = workspace`, `account_id` null) and `activate_commercial_plan_change` remain readable and replayable.

## Runtime propagation

`account_commercial_packages` is updated inside the activation RPC (`source = plan_change`). Account settings are **not** overwritten; effective caps follow:

`min(account_setting, package_cap, global_hard_cap)`

Worker reads `account_commercial_policy_revisions` (fallback: active `account_commercial_packages`) to detect package changes.

## Queued vs active runs

- **Enqueue**: worker `create_account_run_request` stamps `commercial_policy_revision` when absent.
- **Queued**: dispatcher compares metadata revision with the latest revision; if metadata is absent, fail-closed when `package_starts_at > request.created_at`.
- **Blocked queued run**: status `blocked`, code `commercial_policy_revision_changed` — not a success; scheduler may enqueue a fresh request with the new policy.
- **Active account session**: central guard `commercial_policy_boundary_blocks_phase` at `before_welcome_phase`, `before_follow_phase`, `before_unfollow_phase`, `before_outreach_phase`. Mid-phase caps still reload via existing runtime readers (`account_package_summary`, `runtime_caps`).

## Package → runtime matrix (per account)

| Domain | Cap/feature source | account_id | Pro→Growth | Growth→Pro | Active re-read point |
|--------|-------------------|------------|------------|------------|----------------------|
| Follow | `get_follow_runtime_cap_inputs` → `min(setting, package, warmup, day)` | yes | lower cap | higher cap allowed, settings preserved | each followers engine invocation / cap checkpoint |
| Unfollow | `ig_account_unfollow_settings` + `resolve_unfollow_runtime_cap` | yes | lower session cap | higher cap allowed | unfollow handoff + session start |
| Welcome/DM | `resolve_welcome_send_limits` + package preview | yes | feature/cap clamp | may unlock if settings already enabled | welcome phase boundary |
| Outreach addon | env gate + orchestrator max jobs + package entitlement | yes | may skip phase | may run if gates pass | outreach phase boundary |
| Like (post-follow) | `config` session caps in navigation engine | yes | global/session caps unchanged by package writer | same | runner checkpoints |
| Scheduler eligibility | assignment/schedule RPCs per `account_id` | yes | unchanged other accounts | unchanged other accounts | next scheduler tick |
| Dispatcher | `evaluate_queued_run_commercial_policy` per claimed `account_id` | yes | blocks stale queued run for A only | n/a | claim time |

Effective policy: `min(account_setting, package_cap, global_hard_cap)`. Features: `account_preference AND package_allowed AND global_allowed`.

## Isolation

A plan change on account A never modifies entitlements, credits, packages, or policy revisions for B/C/D/E.

## Stripe Test foundation

- Plan-change Stripe checkout still uses `quote.amount_due_cents` (no second prorata).
- Metadata may include `account_id` and `change_scope`.
- Target recurring price resolution may use `target_outreach_addon_key` from the quote.
- No Stripe Dashboard / Product / Price setup in this phase.

## Public flows

First purchase, additional account, simulations, and public checkout pages are unchanged.
