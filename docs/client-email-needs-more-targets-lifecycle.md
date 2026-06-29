# Client email — needs more target accounts lifecycle (TASK 7A / TASK 18A)

First client lifecycle email category: **`needs_more_target_accounts`**.

## Gates (default safe)

| Variable | Default | Role |
|----------|---------|------|
| `CLIENT_EMAIL_SENDING_ENABLED` | `false` | Global client send master gate |
| `CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED` | `false` | Category automation gate |
| `CLIENT_EMAIL_MATERIALIZE_ENABLED` | unset / `false` | RPC materialization gate |
| `CLIENT_EMAIL_TEST_SENDING_ENABLED` | `false` | Internal test delivery (unchanged) |

Automation, materialization, and global sending gates must be explicitly open before any persist/send path is allowed. TASK 18A ships the 24h runner in **preview/shadow only**.

## Canonical sources read by reconciliation

| Signal / data | Source |
|---------------|--------|
| Active `needs_more_target_accounts` signal | `account_dashboard_actions` via `loadActiveNeedsMoreTargetAccountsAction` |
| **`needs_more_active_since`** | `account_dashboard_actions.created_at` of the active signal (`resolveNeedsMoreActiveSince`) |
| `eligible_target_count` | `ig_targets` via `loadTargetEligibilityCountsForAccount` / snapshot input |
| Client communication email (future send) | `resolveClientCommunicationEmail` (`clients.metadata` only) |
| Sequence business state | `client_email_needs_more_targets_sequences` |
| Send attempts / archive | `client_email_send_intents` (`intent_kind=client`) |

Client notifications (`client_account_notifications`) remain independent — email sends do not resolve them.

## Sequence rules (TASK 18A contract)

- Signal active when **`eligible_target_count <= 5`** (raw added count never suffices)
- **First reminder email** eligible at **`needs_more_active_since + 24h` UTC** — no send at signal activation
- Stop when `eligible_target_count > 5`, signal resolved, or account canceled
- Re-open after resolution → new `created_at` → new 24h period; never reuse old episode timing
- **Product-active reminders:** index `0` only (24h). Indices `1–5` remain reserved in schedule constants for future cadence
- CTA deep link: `/instagram-client?view=targeting&account=<account-id>` (tenant-guarded session)
- Triggers: `automatic_initial` (index 0), `automatic_reminder` (reserved indices)

## Code map

| Piece | Path |
|-------|------|
| 24h due evaluation | `lib/instagram-dashboard/client-email-needs-more-24h-due.ts` |
| Preview/shadow runner | `lib/instagram-dashboard/client-email-needs-more-targets-runner.ts` |
| Targeting CTA URL | `lib/instagram-dashboard/client-email-needs-more-targeting-url.ts` |
| Reminder/stop contract | `lib/instagram-dashboard/client-email-reminder-contract.ts` |
| Sequence episode model | `lib/instagram-dashboard/client-email-needs-more-targets-sequence.ts` |
| Reconciliation orchestrator | `lib/instagram-dashboard/client-email-needs-more-targets-reconcile.ts` |
| Lifecycle preview | `lib/instagram-dashboard/client-email-needs-more-targets-preview.ts` |
| Automation gate | `lib/instagram-dashboard/client-email-needs-more-targets-automation-config.ts` |

TASK 18A ships reconciliation, 24h due logic, runner preview, UI, and tests — **no scheduler, no Postmark calls, no intents persisted, no RPC materialize**.
