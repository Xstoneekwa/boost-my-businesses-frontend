# Commercial outreach message quality V3

Scope: copy generation/validation only. Discovery, scoring, recommendations,
lead review, owner security, all existing RPCs/state transitions, transport,
Phone Farm, Stripe and restaurant code are unchanged. No real send/auto-approval.

## Version contract

Prompt: `commercial_outreach_message_quality_v3`.
Four new catalogue entries: `IG_BEAUTY_ANGLE_{A,B}_V3` and
`EMAIL_BEAUTY_ANGLE_{A,B}_V3`. Historical V1 catalogue entries are not updated.

`template_key` deliberately stays the stable V1 **routing family**. The existing
lead synchronizer compares this field to the lead's selected channel/angle;
changing it would cancel approved historical messages during later lead edits.
`template_version` identifies the actual V3 copy catalogue entry. An insert-only
trigger stamps this metadata on new empty drafts, including replacements made
by the existing regenerate RPC. No existing row is rewritten by the migration.
The processor looks up the exact copy version; a legacy draft cannot silently
receive V3 text under V1 metadata. It fails closed and needs explicit regeneration.
Model, prompt version, full facts used, bounded attempts and supersession history
remain stored through the existing generation completion RPC.

## Copy gate

`BMB_VALUE_PROPOSITION_PRESENT` checks ordered linked clauses, not a bag of words:
BMB identifies relevant Instagram audiences around similar businesses/competitors
→ targeted interactions → brings people to the prospect's profile → potential
customers/qualified growth. Angle A additionally needs growth/visibility language.
The mechanism must be in one connected statement or two adjacent linked sentences;
CTA-only evidence, disconnected keywords and negated mechanisms fail closed.
This deterministic grammar is intentionally bounded, not full semantic proof.
Natural wording outside its accepted grammar may require the bounded retry.

The prompt requests observation → opportunity → mechanism → benefit → audience
demo CTA. A required structured `personalization_evidence` contains a literal
source quote and fact key. The quote must occur in the verified ledger and opening
observation, and the full source fact must be cited in `facts_used`. Where a bio
exists, city-only citations fail; a specific service/booking/bio phrase is required.
This validates evidence, not every semantic assertion. Human review remains vital.
The quote is checked before completion; the existing DB stores its full source
fact, not an additional model self-evaluation column.

Existing greeting policy is unchanged; a personal first name still requires an
owner-verified fact. No canonical signature is configured, so omit all signatures.
Placeholder detection adds separated TODO/TBD/PLACEHOLDER forms to existing
bracketed, malformed, full-width and zero-width token protection. Purchase-intent
claims such as “eager to engage” / “ready to buy” fail. No guaranteed customers.
The optional exact Meta Ads comparison stays email-only. Bounded two-attempt
generation and pre-RPC owner edit/approval validation are retained.

## Safe reevaluation and release

`planCommercialOutreachV3` is a pure read-only planner:

- Any approval marker/state → OWNER_APPROVED, preserve regardless of V3 quality.
  A critical placeholder is reported for owner attention, never silently changed.
- CANCELLED and FAILED → preserve; do not reset retry counters.
- READY_NOT_APPROVED → regenerate only if placeholder or mechanism gate fails.
  Passing text remains; owner-edited text requires owner review instead.
- Unknown/in-flight states → preserve/fail closed.

For release execution, save a full baseline outside git. Recheck exact old ID,
version, subject/body/hash, approval markers and `owner_edited` under row lock;
only then invoke the existing owner-authorized regenerate RPC. Idempotency keys
are release/item-specific. Do not fabricate approvals or ratings.

Deploy V3 runtime first, then apply the additive catalogue/insert-trigger migration,
then regenerate the exact eligible set. Do not run a legacy worker against V3
draft metadata. Existing ready/approved items are unaffected by this sequence.
Rollback code requires stopping new V3 draft processing first; do not rewrite
historical versions to make an old worker accept them.

Observed baseline: 7 approved, 6 ready not approved (5 Instagram B, 1 email B),
12 cancelled, no failed/in-flight drafts. No eligible A example exists: do not
alter recommendations or approve new leads to manufacture coverage. All four
channel/angle combinations are covered in local tests.

## Measurement / tests

Report placeholder, mechanism, greeting and CTA checks on the final six previews.
Factual grounding means audit against supplied ledger, not independent proof of
the business's claims. Human sendability/minor-edit/reject rates remain unmeasured
until Liam reviews V3. First-pass success uses all six attempted replacements in
the denominator; retry rate counts bounded second attempts, including failures.
The planned V2→V3 replacement rate is a separate metric, not hidden as a retry.

- Focused Node tests: outreach, V3 planner/guards, human review, owner access,
  dashboard, lead review.
- `supabase/tests/run-commercial-outreach-copy-v3.mjs`: isolated local PG fixture,
  rollback including DDL; verifies historical rows/catalogue/RPC definitions,
  four new paths, existing regenerate RPC, later lead edits and revoked ACLs.
- Existing foundation/orchestration and human-review SQL suites unchanged.
- Production build, diff check, authenticated visual review and before/after
  approved/cancelled/lead/review hash comparison are required at release.
