# Known gaps

Snapshot date: **2026-07-20**.

## Immediate validation gap

- The backend handoff and login route are production-validated.
- Liam has not yet physically observed the success page redirect to
  `/instagram-login` and completed login from that page.
- If polling does not redirect the already-open page, one refresh of the same
  redacted existing-session URL is allowed; no new Checkout Session is needed.

## Commercial gaps

- Stripe Live is not implemented, enabled or validated by this checkpoint.
- The server-side maximum-15-CT gate is absent.
- Add Instagram account onboarding is the next phase and must not begin before
  that gate is in place.
- `additional_account` remains non-secured and must not be used.
- No Instagram account exists for this tenant yet; the entitlement is correctly
  reserved with `account_id=null`.

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
