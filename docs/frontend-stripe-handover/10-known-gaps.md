# Known gaps

Snapshot date: **2026-07-21**.

## Immediate validation gap

- The backend handoff and login route are production-validated.
- Liam has not yet physically observed the success page redirect to
  `/instagram-login` and completed login from that page.
- If polling does not redirect the already-open page, one refresh of the same
  redacted existing-session URL is allowed; no new Checkout Session is needed.

## Commercial gaps

- Stripe Live is not implemented, enabled or validated by this checkpoint.
- The server-side minimum-15-eligible-CT gate and the five-step Add Instagram
  account flow are deployed. The additive migrations are applied and the
  orchestration RPCs are restricted to the server role. The flow has not yet
  been physically validated with a real Instagram account.
- No maximum CT rule was introduced. The value 15 is the minimum required for
  onboarding completion.
- `additional_account` remains non-secured and must not be used.
- No Instagram account exists for this tenant yet; the entitlement is correctly
  reserved with `account_id=null`.

## Profile Intelligence V1 residual gaps

- The provider schema is account-dependent. The canary did not prove a stable
  Instagram user ID or expose privacy, verification, business, category,
  external-link, contact or location facts; the implementation keeps them
  unknown when absent.
- Language support is intentionally limited to conservative deterministic FR/EN
  detection. It is not an AI classification and ambiguous text remains unknown.
- An expired provider avatar falls back to an initial during ordinary rendering.
  Refreshing the CDN URL requires the explicit same-session reanalysis action;
  the avatar route never performs a hidden paid lookup.
- V1 is deployed at commit `cc73eb26ae99f0ca5d597d0660763742fabbdaf1`.
  Its factual limitations remain deliberate: absent provider facts stay unknown.

## Profile Intelligence V2 residual gaps

- V2 is local only. The bounded default is `gpt-4o-mini-2024-07-18` with
  localized `profile_intelligence_v2_prompt_v4_no_geo_fr|en` prompts and
  deterministic post-schema language and no-geography contracts.
- Confirmed V2 criteria are not connected to Target AI V2.2 and create no CT.
- AI geography is intentionally absent. Public location remains factual and
  target geography remains client-confirmed at the Targeting step.
- JSONB optimistic concurrency is intentionally used to avoid a migration. A
  future high-volume design could move the lease to an atomic RPC, but no such
  production migration is justified for this bounded onboarding action.

## Environment gap

Preview builds successfully, but the polling route cannot be smoked there
because the Preview environment lacks the server-only Supabase service-role
variable. Production has the required server environment and passed the same
existing-session smoke. No secret should be copied merely to make Preview mimic
Production.

## Existing test baseline

One unrelated cancellation-projection assertion remains red in the broader
commercial suite. It predates this handoff fix and is not evidence of a reserved
entitlement regression.

## Operator stop conditions

Stop before any account onboarding if:

- login redirects to another tenant or identity;
- the dashboard shows an Instagram account already attached;
- the entitlement is missing, duplicated or no longer reserved;
- the UI offers an `additional_account` path for this initial onboarding;
- any Live Stripe identifier or Live-mode label appears;
- the existing success page attempts to create another Checkout Session.

References:

- [Current state](01-current-state.md)
- [Tenants, users and commercial units](04-tenants-users-commercial-units.md)
- [Test evidence matrix](09-test-evidence-matrix.md)
