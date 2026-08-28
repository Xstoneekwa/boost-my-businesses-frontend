# Human Review Canary & Funnel Feedback V1

## Scope and measurement

Owner-only (`authenticated AND superadmin AND commercial_crm_access`), with the
canary's reviewer bound to the verified owner identity at enrollment. There is no
frontend email or generic-admin shortcut. No new table or public RLS policy.
The existing append-only `commercial_events` stream owns the measurement.

Enrollment is explicit and atomic: 15 urgent/P1 + the best 10 high/P2, ordered by
score descending, created_at ascending, UUID ascending. Previously human-edited
leads are excluded. A mismatch rolls back enrollment; re-enrollment cannot replace
the cohort. Snapshot includes original score, priority, channel, angle, baseline
revision and reviewer ID. Scores are DB-frozen for these leads. Discovery scoring,
channel and angle recommendation source are unchanged.

The new queue defaults to this cohort independently of global date/geography
filters. Its own queue filters still apply. `All pending leads` remains available.

`Start review` is an explicit first interaction per page session. It creates one
server-timestamped `human_review_started`; the next selected cohort lead starts
automatically during that session. A page visit, GET, prefetch or browser smoke
never starts a review. Refreshing requires Resume review. Duration is elapsed
server time **including breaks**, not a claim about active working minutes.

The existing canonical review RPC/transition remains authoritative. An AFTER INSERT
trigger on its approved/rejected/updated events atomically captures meaningful
field edits and completion. It requires the enrolled owner and start event; a
failure rolls back the decision and outreach creation. Original AI data is never
overwritten. Changes reverted before final approval count as edits but agreement
compares the original recommendation to the final saved selection.

Events:

- `human_review_canary_enrolled`: system enrollment only; no human outcome.
- `human_review_started`: one per member, idempotent, server time.
- Existing `lead_review_updated`, `lead_approved`, `lead_rejected` retained.
- `human_review_edited`: only actual changed fields; contains `changed_fields` and
  `final_selection`. No extra duplicate channel/angle override event is required.
- `human_review_completed`: original AI + final human values, override booleans,
  edit indicator, reject reason, optional note, timestamps and elapsed seconds.

The existing seven rejection reasons are reused. A reason is required for canary
rejection; an optional note is accepted for any reason. Rejection remains terminal.

## Analytics semantics

The owner-gated read model fetches at most 25 enrollments, 50 start/completion events,
25 lead statuses and 25 active outreach items. Unexpected cardinality fails closed.
Historical approvals/rejections and non-cohort leads never enter the denominators.
No decisions => rates and timing are null (`—`), not fabricated zero percentages.

- Approval rates: approved / reviewed, grouped by original AI P1/P2 and score band.
- Agreement: unchanged original vs final channel/angle / comparable **approved**
  reviews. Rejection is not an implicit endorsement of the unchanged recommendation.
- Edit rate: reviews with a meaningful saved change / completed reviews.
- Median/P90: continuous interpolated percentile of server elapsed durations.
- Top rejection reasons derive from completed rejected reviews.
- Funnel first 3 stages count entry into this pre-qualified cohort; current pending
  is separate. Approved is cumulative completed approvals. Preview Ready requires
  a current non-cancelled, matching channel/angle, nonempty, validation-passing
  preview. Message Approved requires `queued_dry_run`.
- Missing active item, missing valid preview and terminal failure are distinct.

No Sent/Replies/Demos/Paid metrics are displayed during this transport-off phase.
The existing generic CRM and both workspaces remain available.

## Automatic dry-run continuity

The existing lead-update trigger creates exactly one active outreach path (DB
unique index), preserves final human channel/angle, and cancels rejected leads.
Canary completion verifies this invariant inside the decision transaction.
The approval route schedules the existing generator with Next.js `after()`;
the existing minute cron is the durable retry mechanism. Expired generation leases
(10 minutes) become explicit failures and use only the remaining attempt budget
(normally 2). Unexpected generator errors are persisted. Pending previews refresh
the dashboard every 10 seconds; no manual generation/reporting step is necessary.

Real email, Instagram DM, Phone Farm DM, SMTP, Postmark marketing and auto-approval
are all OFF. The DB's existing transport-forbidden constraint remains intact.
Approving a message only creates `queued_dry_run`.

## Validation and deployment

Baseline: production `32850b23670f8ba7547969534d61c63be2ebaf42`, deployment
`dpl_EFjj7N95cGr6eu1aobhsD6ZPUcFF`. Isolated worktree preserves that production
lineage. RPC migration preflight refuses unrecognized concurrent changes.

Tests run in a disposable **local PostgreSQL 17** database with fixtures, never
against production prospects. `supabase/tests/commercial-human-review-bootstrap.sql`
supplies minimal dependencies, followed by the existing foundation/review/outreach
migrations and this phase's migration; `commercial-human-review-feedback.sql`
executes and rolls back its fixtures. It checks real transaction/trigger behavior,
idempotency, rollback on missing start, edits, approval, reasoned rejection,
terminal rejection, message dry-run, lease retry cap, ACL and denied real send.

Focused JS tests:

```sh
node --test lib/commercial/human-review-feedback.test.mjs lib/commercial/lead-review*.test.mjs lib/commercial/crm-access-policy.test.mjs lib/commercial/outreach-*.test.mjs
npm run build
git diff --check
```

Static visual fixture: `node scripts/commercial-review-visual-fixture.cjs`
at loopback port 3147. It cannot mutate anything and is not an application route.
The in-app browser verified its narrow layout, empty-state metrics, expandable
funnel and disabled decision controls before Start. The viewport override was not
reflected by the browser (reported width 319px); desktop breakpoint verification
is not claimed. Authenticated production smoke requires Liam's own session.

Release order: validate → scoped commit → apply schema (cohort not enrolled yet)
→ deploy production → enroll once as the audited owner → read-only production
smoke. Enrollment must never call start/review/approval RPCs.

Production migration ledger version: `20260828214422`. The local migration filename
matches that assigned version; its SQL is unchanged from the tested/applied migration.

## Post-canary addendum (deferred, not implemented in V1)

The user's subsequent adaptive-review addendum does not change this implementation.
After V1 delivery, assess a first 10 P1, then 5–10 P2 if useful; recommend an explicit
early stop for a strong early signal or a structural failure, with small-sample
caution. Do not equate a promising sample with permanent certification.

Future auto-approval is recommendation-only until separately authorized: no score-only
gate; require fit, reliable evidence, confidence, audience/channel/angle quality,
message guards and system health. Lead approval, message approval and transport are
separate decisions. Shadow measures false auto-approval against actual human decisions
before any gradual enforcement. Human touch rate, minutes/100 leads and exception
causes belong to that later strategy, not the current canary metrics.
