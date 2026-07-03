# Per-account commercial plan change

## Model

- **Scope**: each plan change targets exactly one `ig_accounts.id` via a consumed `client_account_entitlements` row (`account_id` set, `status = entitlement_consumed`).
- **Quotes**: `commercial_plan_change_quotes.change_scope = per_account`, `account_id`, `target_outreach_addon_key`, immutable `pricing_snapshot`, `source_revision` via `commercial_plan_change_source_revision_for_account_source`.
- **Source revision per-account**: `commercial_plan_change_source_revision_for_account_source` reuses the legacy MD5 formula from `commercial_plan_change_source_revision`, then appends `:` + `account_id`. It joins `client_account_entitlements` (`e`) and `commercial_checkout_sessions` (`s`) with `e.id = p_entitlement_id`, `s.id = p_session_id`, `e.account_id = p_account_id`, `e.account_id IS NOT NULL`, and `e.client_id = s.client_id`. Any mismatch returns `NULL` (fail-closed).
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
- Metadata includes `account_id`, `change_scope`, and source entitlement identity when present.
- Target recurring price resolution may use `target_outreach_addon_key` from the quote.
- Stripe subscription lookup is entitlement-scoped, not client-wide.
- Payment confirmation must rebind only the source entitlement/account projection. If rebind or sync cannot be proven, fulfillment stays `reconciliation_required`; no internal activation and no second Checkout.
- No Stripe Dashboard / Product / Price setup in this phase.

Unsupported transitions remain fail-closed until a dedicated product decision/implementation:

- `full_cycle -> outreach_only`
- `outreach_only -> full_cycle`
- Outreach Standard -> Outreach AI
- Outreach removal
- duration changes

## Public flows

First purchase, additional account, simulations, and public checkout pages are unchanged.

## Server-only RPC access (per-account)

The five per-account plan-change RPCs are **server-only** and must never be called from browser `anon`/`authenticated` PostgREST clients:

- `commercial_plan_change_source_revision_for_account_source`
- `account_scoped_credit_balance_cents`
- `activate_commercial_plan_change_per_account`
- `apply_account_commercial_package_plan_change`
- `bump_account_commercial_policy_revision`

**Authorized role**: `service_role` only (Next.js API routes via `createSupabaseClient()`).

**Explicitly denied**: `public`, `anon`, `authenticated`.

Migration `20260710150300_restrict_per_account_plan_change_rpc_privileges.sql` enforces this with `REVOKE`/`GRANT` only (no body or signature changes).

**PostgreSQL effective privilege check** (local disposable instance, after applying `20260710150200` + `20260710150300`):

```sql
select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (...);
```

Expected: `anon=false`, `authenticated=false`, `service_role=true`; no `=X/` PUBLIC entry in `proacl`.

**Production follow-up** (separate task): apply `20260710150300` remotely, then reconcile migration history (`20260703134532` → `20260710150200`) without re-running DDL.

## Local PostgreSQL validation (pre-production)

Before applying commercial migrations to production, run the full SQL file on a disposable local PostgreSQL instance with the plan-change prerequisite migrations (`20260615143000`, `20260621120000`, `20260622120000`) plus production tables already present on the shared database (`account_commercial_packages`, `client_instagram_accounts`). The migration must execute without PostgreSQL errors; `commercial_plan_change_source_revision_for_account_source` must return a non-empty revision for coherent entitlement/session/account fixtures and `NULL` on account or client mismatch.
