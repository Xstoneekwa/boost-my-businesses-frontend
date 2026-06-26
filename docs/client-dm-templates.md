# Client DM Templates

Account-scoped DM configuration for the Instagram client dashboard.

## Scope

- **Welcome DM** — included on Pro/Premium via `client_entitlements` (`feature_code: welcome`).
- **Outreach DM** — optional add-on per account via RPC `client_account_has_outreach_entitlement`.

Configuration is never global at client level: each linked Instagram account has its own templates and toggles.

## Canonical data path

```
Client dashboard (DM Templates tab)
  → GET/PATCH /api/instagram-client/accounts/:accountId/dm-templates[...]
  → lib/instagram-dashboard/dm-domain-service.ts
  → ig_account_dm_settings + ig_dm_templates
  → Admin /api/instagram-dashboard/settings/dm (same service)
  → BotApp relay (existing, authenticated server-side)
```

The browser never calls BotApp directly. Saving a template does not enqueue sends or trigger runs.

## Client API

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/instagram-client/accounts/:accountId/dm-templates` | GET | Projection with `canConfigureWelcome`, `canConfigureOutreach`, CTAs |
| `/api/instagram-client/accounts/:accountId/dm-templates/welcome` | PATCH | `{ enabled?, message? }` — 403 `welcome_dm_locked` on Growth |
| `/api/instagram-client/accounts/:accountId/dm-templates/outreach` | PATCH | `{ enabled?, message? }` — 403 `outreach_dm_locked` without entitlement |
| `/api/instagram-client/outreach-activation/offer` | GET | Catalog-backed offer; `outreach_offer_not_configured` when missing |

## UI behaviour

| State | Welcome card | Outreach card |
|-------|--------------|---------------|
| No linked IG account | Empty state only — no editable fields | — |
| Growth | Visible, locked; CTA → Change Plan `?intention=welcome_dm&target=pro` | Locked until outreach entitlement |
| Pro/Premium + welcome entitlement | Textarea, toggle, `{{username}}` | Depends on outreach entitlement |
| Outreach not entitled | — | Locked; CTA → `/instagram-client/activate-outreach?account_id=…` |

## Upgrade / activation paths

- **Welcome (Growth)** — `/instagram-client/change-plan?intention=welcome_dm&target=pro`
- **Outreach** — `/instagram-client/activate-outreach?account_id=…&addon=outreach_standard` (price from `OUTREACH_ADDONS`; no frontend activation)

## Canonical account relations

| Role | Table | Fields used |
|------|-------|-------------|
| Client ↔ account link | `client_instagram_accounts` | `client_id`, `account_id`, `login_status`, `onboarding_status`, `provisioning_status` |
| Instagram identity | `ig_accounts` | `id`, `username`, `status`, `admin_lifecycle_status` |
| Commercial package per account | `account_commercial_packages` / `account_package_summary` | `package_code`, `commercial_package_code` |

Username is always read from `ig_accounts`, never from the link table.

## Client subscription label priority

1. Entitlement `plan_key` when it is a known commercial plan (`growth` / `pro` / `premium`)
2. Entitlement `commercial_package_code` when `plan_key` is a runtime code (`full_cycle`, etc.)
3. Best active linked account package (Premium > Pro > Growth)
4. Activated checkout session `plan_key`
5. Active `client_subscriptions.metadata` plan hint
6. « Formule en cours d'activation » only when none of the above apply

## Tests

```bash
node --test lib/instagram-client/client-dm-templates.test.mjs
```

Non-regression (client journey):

```bash
node --test lib/instagram-client/client-accounts.test.mjs
node --test lib/commercial/plan-change-quote-activation.test.mjs lib/commercial/plan-change-checkout-idempotency.test.mjs
```

## Local visual check (Lucie Rolandise)

1. Open `/instagram-client` while logged in as Lucie.
2. Open sidebar tab **DM Templates**.
3. Without a linked IG account: confirm empty state — *« Ajoutez un compte Instagram pour configurer ses messages. »*
4. Return to **Vue d'ensemble** → Add Account when ready.
