# Client email — needs more target accounts lifecycle (TASK 7A)

First client lifecycle email category: **`needs_more_target_accounts`**.

## Gates (default safe)

| Variable | Default | Role |
|----------|---------|------|
| `CLIENT_EMAIL_SENDING_ENABLED` | `false` | Global client send master gate |
| `CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED` | `false` | Category automation gate |
| `CLIENT_EMAIL_TEST_SENDING_ENABLED` | `false` | Internal test delivery (unchanged) |

Both automation and global sending gates must be `true` before any lifecycle persist/send path is allowed.

## Canonical sources read by reconciliation

| Signal / data | Source |
|---------------|--------|
| Active `needs_more_target_accounts` signal | `account_dashboard_actions` via `loadActiveNeedsMoreTargetAccountsAction` |
| `eligible_target_count` | `ig_targets` via `loadTargetEligibilityCountsForAccount` / snapshot input |
| Client communication email (future send) | `resolveClientCommunicationEmail` (`clients.metadata` only) |
| Sequence business state | `client_email_needs_more_targets_sequences` (after TASK 7A migration GO) |
| Send attempts / archive | `client_email_send_intents` (`intent_kind=client`) |

Client notifications (`client_account_notifications`) remain independent — email sends do not resolve them.

## Sequence rules

- Start when signal active **and** `eligible_target_count <= 5`
- Stop when `eligible_target_count > 5`, signal resolved, or account canceled
- Six sends max per episode (indices 0–5) at T+0, +48h, +5d, +9d, +14d, +21d from episode start
- Triggers: `automatic_initial` (index 0), `automatic_reminder` (index 1–5)

## Code map

| Piece | Path |
|-------|------|
| Reminder/stop contract | `lib/instagram-dashboard/client-email-reminder-contract.ts` |
| Sequence episode model | `lib/instagram-dashboard/client-email-needs-more-targets-sequence.ts` |
| Reconciliation orchestrator | `lib/instagram-dashboard/client-email-needs-more-targets-reconcile.ts` |
| Automation gate | `lib/instagram-dashboard/client-email-needs-more-targets-automation-config.ts` |
| Migration (local) | `supabase/migrations/20260629120000_client_email_needs_more_targets_sequences.sql` |

TASK 7A ships reconciliation and tests only — **no scheduler, no Postmark calls, no intents persisted**.
