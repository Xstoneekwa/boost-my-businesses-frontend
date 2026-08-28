# Commercial outreach message quality V2

Message-only change. Discovery, scoring, priorities, channel/angle recommendations,
owner identity, RPCs, state transitions and transport configuration are unchanged.
No database migration is required. Email, Instagram and Phone Farm delivery and
auto-approval remain off.

## Guard and generation contract

- `outreach-quality.ts` produces `display_name_for_greeting` and the greeting.
  Short recognizable business labels are allowed; descriptive/location suffixes
  are stripped conservatively. Long, generic or ugly handles fall back to
  `Hi there,`. A first name requires an explicit `owner_verified_contact` fact;
  the current production fact ledger does not infer or supply this fact.
- Brackets, braces, angle-bracket tokens (including malformed forms), TODO/TBD,
  normalized full-width tokens and common substitution syntax fail closed.
- The prompt locks BMB to relevant Instagram audiences and potential customers.
  Angle A emphasizes growth/visibility around similar businesses; angle B
  emphasizes acquisition. No change to which angle/channel was recommended.
- A concrete audience demonstration question is required, not a demo booking.
  IG stays short; emails require paragraphs and a subject. Only email may use
  the optional exact comparison `up to 3–4× less than Meta Ads`.
- Existing factual, wrong-city, wrong-business and verified-fact-ledger guards
  remain. Recipient binding uses the exact canonical `business_name` fact, not
  a forced long salutation. This is not semantic proof of every generated fact;
  human review is still required.
- Generation, owner edits AND owner approvals run the same server validation.
  Auth and optimistic version checks remain in place. Direct authenticated/anon
  RPC and table access remains revoked; existing service-role callers are trusted.
- The existing claim RPC bounds generation to two attempts. It clears current
  failure codes, so the processor reads the last failure from the append-only
  audit for retry feedback. Invalid content is never finalized successfully by
  the processor. Exhausted attempts remain failed for owner attention.

## Human decisions: existing actions, no new states

- `SENDABLE_AS_IS`: existing `approve_message` → `queued_dry_run` only.
- `MINOR_EDIT`: opens editor; a successful save records existing `message_edited`
  and `owner_edited=true`. Opening the editor alone is not counted as a decision.
- `REJECT`: confirmed cancellation of the preview with
  `message_quality_reject`; the approved lead is unchanged.

## Ten-preview canary

Only the ten already-approved P1 leads from human review Stage 1 are in scope.
Regenerate via the existing owner-authorized, versioned and idempotent RPC after
deployment. Old bodies remain in cancelled items, linked by `supersedes_item_id`.
Do not approve messages or fabricate human ratings during verification.

Measure the four deterministic quality rates on the ten final V2 previews.
First-pass success = ready on attempt 1 / ten requested previews.
Regeneration rate = previews needing a second V2 generation attempt / ten.
The planned replacement of ten V1 previews is separately 10/10, not a retry rate.
Report failures in the denominator. Technical quality is NOT human sendability
and is NOT evidence of conversion performance. Liam reviews these ten messages
before moving to the five P2 leads.

## Regression coverage

`outreach-validation.test.mjs` covers requested tokens, greeting fallback and
verified first name, four channel-angle paths, copy guards, preserved email
paragraphs, no silent truncation, failed/clean retry paths and pre-RPC edit/approval
blocking. Existing architecture, owner-policy, UI and SQL transaction suites
cover delivery-off, revoked access, immutable review history, state constraints,
versioning, retry bounds and lease recovery.
