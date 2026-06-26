# Client email — Postmark provider (TASK 6A)

Transactional email V1 uses **Postmark** with a single locked sender:

- From: `growth@boostmybusinesses.com`
- Stream: `outbound` (transactional only)
- Templates: stored in `client_email_templates` (BotApp / DB), **not** in Postmark

## Production safety gate (TASK 6A)

Sending remains disabled until a dedicated send task is approved.

| Variable | Production expectation |
|----------|------------------------|
| `CLIENT_EMAIL_PROVIDER` | `postmark` |
| `CLIENT_EMAIL_SENDING_ENABLED` | `false` |
| `POSTMARK_SERVER_TOKEN` | configured in Vercel Production only |
| `POSTMARK_WEBHOOK_USERNAME` | configured in Vercel Production only |
| `POSTMARK_WEBHOOK_PASSWORD` | configured in Vercel Production only |

Never commit these values. Do not add them to public `.env.example` files.

## Code map

| Piece | Path |
|-------|------|
| Provider env + gate | `lib/instagram-dashboard/client-email-provider-config.ts` |
| Neutral provider contract | `lib/instagram-dashboard/client-email-provider.ts` |
| Postmark adapter (no send in 6A) | `lib/instagram-dashboard/client-email-postmark-adapter.ts` |
| Webhook auth | `lib/instagram-dashboard/client-email-postmark-webhook-auth.ts` |
| Webhook ingestion | `lib/instagram-dashboard/client-email-postmark-webhook.ts` |
| HTTP route | `app/api/webhooks/postmark/route.ts` |

## Postmark server setup (manual)

Recommended server name:

`BoostMyBusinesses Transactional Production`

Rules:

- Transactional **outbound** stream only
- No broadcast/marketing stream usage
- Open tracking: **off**
- Click tracking: **off**
- No Postmark templates (DB/BotApp owns template content)

## Webhook setup (after production deploy)

Configure Postmark webhooks on the **outbound** stream for:

- Delivery
- Bounce
- Spam complaint
- Subscription change / suppression
- SMTP/API errors (if available)

Use HTTPS Basic Auth with the Vercel Production secrets above.

**Do not** enable open tracking, click tracking, or inbound email.

Webhook URL path:

`/api/webhooks/postmark`

Do not paste credentials into tickets, chat, or git.

## DNS (Namecheap)

Domain verification must use **exact** DNS values from the Postmark domain settings UI.

Before adding records:

1. Compare each proposed Postmark record with existing Namecheap DNS.
2. Never create a second SPF TXT record — merge into the existing SPF if needed.
3. Typical Postmark additions (confirm in Postmark before applying):
   - DKIM TXT on the selector Postmark provides
   - Return-Path CNAME (`pm-bounces` → `pm.mtasv.net`) if not already present
   - SPF merge: add `include:spf.mtasv.net` to the existing SPF record

Keep existing DMARC monitoring unless Postmark and deliverability review recommends a change.

## Verification checklist

1. `CLIENT_EMAIL_SENDING_ENABLED=false` in Production
2. Webhook test from Postmark returns HTTP 2xx (no real email required for auth/route tests)
3. Email History remains empty until real intents exist
4. BotApp Templates stay editable from relay routes only
