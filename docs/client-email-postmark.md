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
| Webhook HTTP route | `app/api/webhooks/postmark/route.ts` |

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
