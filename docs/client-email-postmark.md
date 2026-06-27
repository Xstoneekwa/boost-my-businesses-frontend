# Client email — Postmark provider (TASK 6A–6C)

Transactional email V1 uses **Postmark** with a single locked sender:

- From: `growth@boostmybusinesses.com`
- Stream: `outbound` (transactional only)
- Templates: stored in `client_email_templates` (BotApp / DB), **not** in Postmark

## Production safety gates

| Variable | Production expectation |
|----------|------------------------|
| `CLIENT_EMAIL_PROVIDER` | `postmark` |
| `CLIENT_EMAIL_SENDING_ENABLED` | `false` (client lifecycle sends) |
| `CLIENT_EMAIL_TEST_SENDING_ENABLED` | `false` (allowlisted internal test sends) |
| `CLIENT_EMAIL_TEST_RECIPIENT` | unset until an explicit test-send GO |
| `POSTMARK_SERVER_TOKEN` | configured in Vercel Production only |
| `POSTMARK_ACCOUNT_TOKEN` | optional; server-side only for sender identity sync (TASK 9A) |
| `POSTMARK_WEBHOOK_USERNAME` | configured in Vercel Production only |
| `POSTMARK_WEBHOOK_PASSWORD` | configured in Vercel Production only |

Never commit these values. Do not add them to public `.env.example` files.

## Test delivery (TASK 6C)

Internal test sends are a **separate path** from client lifecycle email:

- Route: `POST /api/instagram-dashboard/email-test-delivery` (relay/admin only)
- Status: `GET /api/instagram-dashboard/email-test-delivery`
- Recipient comes **only** from `CLIENT_EMAIL_TEST_RECIPIENT` — never from request body, client metadata, Instagram, credentials, or Vault
- Intents use `intent_kind=test`, `trigger=manual_test`, null `client_id` / `account_id`
- Email History shows badge **Test delivery** and masks the test recipient in relay projections
- Idempotency key: `manual_test:{category}:{template_id}` — one test per template key
- Postmark metadata: `intent_id`, `is_test=true`, `category`, `trigger=manual_test`
- Open/link tracking: **off**

Requires local migration `20260628120000_client_email_test_intents.sql` (not applied in TASK 6C deploy).

## Transactional delivery settings (TASK 9A)

BotApp can manage two separate settings once migration `20260701120000_transactional_email_delivery_settings.sql` is applied:

- **Active sender address** — selectable only from confirmed Postmark sender identities after an explicit refresh (`POSTMARK_ACCOUNT_TOKEN`, server-side only)
- **`{{support_email}}`** — central support email used in previews and future sends

Routes (relay/admin only, `Cache-Control: no-store`):

- `GET /api/instagram-dashboard/email-delivery-settings`
- `POST /api/instagram-dashboard/email-delivery-settings/refresh-senders`
- `PATCH /api/instagram-dashboard/email-delivery-settings`
- `GET /api/instagram-dashboard/email-delivery-settings/audit`

Until the migration is applied, the resolver falls back to `growth@boostmybusinesses.com` for both values (`source=legacy_default`) with zero writes.

## Code map

| Piece | Path |
|-------|------|
| Provider env + client gate | `lib/instagram-dashboard/client-email-provider-config.ts` |
| Test env + allowlist gate | `lib/instagram-dashboard/client-email-test-config.ts` |
| Test delivery orchestration | `lib/instagram-dashboard/client-email-test-delivery.ts` |
| Postmark test send | `lib/instagram-dashboard/client-email-postmark-test-send.ts` |
| Postmark client adapter (lifecycle blocked) | `lib/instagram-dashboard/client-email-postmark-adapter.ts` |
| Webhook auth | `lib/instagram-dashboard/client-email-postmark-webhook-auth.ts` |
| Webhook ingestion | `lib/instagram-dashboard/client-email-postmark-webhook.ts` |
| Test delivery HTTP route | `app/api/instagram-dashboard/email-test-delivery/route.ts` |
| Delivery settings resolver | `lib/instagram-dashboard/client-email-delivery-settings.ts` |
| Postmark sender identity sync | `lib/instagram-dashboard/client-email-postmark-sender-sync.ts` |
| Delivery settings HTTP routes | `app/api/instagram-dashboard/email-delivery-settings/*` |
| Outbox lifecycle planner (read-only) | `lib/instagram-dashboard/client-email-lifecycle-outbox-plan.ts` |
| Lifecycle readiness projection | `lib/instagram-dashboard/client-email-lifecycle-readiness.ts` |
| Intent parent contract | `lib/instagram-dashboard/client-email-intent-parent-contract.ts` |
| Lifecycle readiness HTTP route | `app/api/instagram-dashboard/email-lifecycle/readiness/route.ts` |
| Webhook HTTP route | `app/api/webhooks/postmark/route.ts` |

## Outbox lifecycle contract (TASK 10A)

Central read-only planner: `buildClientEmailLifecycleOutboxPlan()` — no episodes, sequences, intents, provider calls, or webhooks.

| Gate | Production expectation |
|------|------------------------|
| `CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED` | `false` until explicit GO |
| `CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT` | unset until explicit GO (anti-backfill watermark) |
| `CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT` | unset until explicit GO |

### Intent parent linkage (local migration, not applied)

`20260702120000_client_email_intent_episode_links.sql`:

| Intent kind | Parent |
|-------------|--------|
| `test` | none (`sequence_id` and `lifecycle_episode_id` null) |
| `client` + `needs_more_target_accounts` | `sequence_id` only |
| `client` + lifecycle categories | `lifecycle_episode_id` only |

Future client intents must snapshot at creation time: recipient canonical email, template id/version, rendered subject/body, `from_email_snapshot`, `support_email_snapshot`, category, trigger, reminder index, parent ref, config version, idempotency key — resolved via `resolveTransactionalDeliverySettings()`, never read back from live settings after send.

Readiness (relay/admin): `GET /api/instagram-dashboard/email-lifecycle/readiness` — booleans and blocking reasons only; no secrets or full client emails.

## Webhook setup

Configure Postmark webhooks on the **outbound** stream for Delivery, Bounce, Spam complaint, and Subscription change.

Webhook URL path: `/api/webhooks/postmark`

Use HTTPS Basic Auth with the Vercel Production secrets above.

**Do not** enable open tracking, click tracking, or inbound email.

## Verification checklist

1. `CLIENT_EMAIL_SENDING_ENABLED=false` in Production
2. `CLIENT_EMAIL_TEST_SENDING_ENABLED=false` in Production
3. Webhook test from Postmark returns HTTP 2xx
4. BotApp **Send test delivery** disabled until gates + migration are ready
5. No client notifications, lifecycle, or CT side effects from test intents
