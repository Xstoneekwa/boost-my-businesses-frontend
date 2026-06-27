# Client email lifecycle episodes (TASK 8A)

Generic lifecycle email episodes for:

- `account_paused`
- `account_canceled`
- `needs_assistance`

`needs_more_target_accounts` remains on `client_email_needs_more_targets_sequences` and is out of scope here.

## Canonical sources (read-only preview)

| Category | Start / active signal | Resolve signal | Transition audit |
|----------|----------------------|----------------|------------------|
| `account_paused` | `ig_accounts.admin_lifecycle_status = paused` | `admin_lifecycle_status = active` | `ig_action_logs.message = account_paused` |
| `account_canceled` | `admin_lifecycle_status = cancelled` | terminal | `ig_action_logs.message = account_cancelled` |
| `needs_assistance` | `admin_lifecycle_status = needs_assistance` | `admin_lifecycle_status = active` | `ig_action_logs.message = account_marked_needs_assistance` |

Client notifications (`client_account_notifications`) remain independent. Email episodes do not resolve notifications.

Client communication email uses `resolveClientCommunicationEmail` only (client metadata + optional workspace auth fallback). Never Instagram login, credentials, or Vault.

## Anti-backfill strategy

1. **Watermark:** future automation reads `CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT` (ISO timestamp). Until set, preview classifies matching historical states as `legacy_state_no_backfill`.
2. **Episode open rule:** after watermark, open one initial episode only when:
   - canonical lifecycle state becomes active for the category, **and**
   - a matching start transition exists in `ig_action_logs` with `created_at >= watermark`.
3. **No static inference:** current status alone never opens an episode for pre-existing accounts.
4. **V1 sends:** one initial email per episode; no automatic reminders for these three categories.

## Code map

| Piece | Path |
|-------|------|
| Contract + anti-backfill planner | `lib/instagram-dashboard/client-email-lifecycle-contract.ts` |
| Read-only preview loader | `lib/instagram-dashboard/client-email-lifecycle-preview.ts` |
| API route | `app/api/instagram-dashboard/email-lifecycle/preview/route.ts` |
| Migration (local, not applied) | `supabase/migrations/20260630120000_client_email_lifecycle_episodes.sql` |

## Blockers noted

- No `paused_at` / `cancelled_at` / `needs_assistance_at` on `ig_accounts`; transition timing relies on `ig_action_logs.created_at`.
- `needs_assistance` has no dedicated `account_dashboard_actions` action_type; lifecycle status is the canonical signal.
