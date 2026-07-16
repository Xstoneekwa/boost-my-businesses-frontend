# 2026-07-16 Production Baseline - Backend

Short name: `JULY_16_PRODUCTION_BASELINE`

Human name: **2026-07-16 Production Baseline - Warmup, Unfollow, Welcome,
Multi-device, Live Counters, Follow Caps, Like Evidence Reuse**

This is the backend rollback and comparison baseline before further performance
work. The reference business commit is
`6f0f3b028379e029f09f66086372bf39798fe193`. Production deployment
`dpl_EQeojpstgH173NGAtjY1tWFAHLGq` was `READY` and served by the canonical
production aliases when this checkpoint was prepared.

Related checkpoints use the same filename date across repositories:

- Worker: `docs/checkpoints/2026-07-16-production-baseline-runtime.md`
- BotApp: `docs/checkpoints/2026-07-16-production-baseline-botapp.md`
- Worker cross-repository summary:
  `docs/checkpoints/2026-07-16-production-baseline-cross-repo.md`

## Scheduler and runtime contract

- Natural scheduling uses the durable launchd dispatcher heartbeat as launch
  authority. The Electron BotApp heartbeat is observability only.
- A request may be created on the first eligible scheduler tick when the
  dispatcher and device heartbeats are fresh, preflight is ready, the window
  and account are eligible, and no conflicting request, run, device lock or UI
  lease exists.
- A ready same-account preflight lease is consumable by the run request; it is
  not treated as a conflicting foreign lease.
- The dispatcher uses a bounded multi-device pool. Isolation is by physical
  device, account, app instance and canonical UI/device lease.
- One phone owns one UI session. Distinct healthy phones may run concurrently;
  simultaneous physical execution remains an observation item below.

## Settings, caps and projections

- Follow resolution is canonical: `follow_limit` is the account production
  limit and `max_follow_per_run` is legacy fallback only.
- The effective cap is the minimum of package, warmup and account day/session
  limits. Mythyl currently projects `120/day` and `20/session`.
- Warmup is calendar based: Day 1 = 10, Day 2 = 20, Day 3 = 40, Day 4+ = package
  maximum. Existing Tracker and Mythyl activation dates were backfilled; future
  activated accounts initialize from the package/service start.
- Unfollow is eligible at J+3, excludes protected candidates, applies production
  day/session limits, and respects the remaining-window guard. The hidden
  one-action safety cap is no longer the production effective cap.
- Profiles polling projects only canonical verified counters. Follow and Like
  live values are sourced asynchronously and do not add a synchronous network
  call between Like and Return CT.

## Incidents and notifications

- Runtime incidents use the generic Incidents/Actions workflow. Human review
  creates an exactly linked, idempotent `operator_review_required` action.
- Canonical UI states are `Action required`, `Reviewed`, `Acknowledged`,
  `Resolved` and `Open`.
- `Mark reviewed` uses the authenticated relay and transactional backend
  transition, preserves the incident and audit, clears `blocking_campaign`,
  records operator identity and `reviewed_at`, and refreshes Incidents/Profiles.
- Slack and Discord share one English-only builder with the hidden canonical
  `Open Incidents/Actions` CTA, delivery records, `delivered_at` and idempotence.

## Security invariants

- Renderers never receive Supabase service-role credentials or direct privileged
  database access.
- Operator mutations pass through the authenticated relay and audited backend
  boundary.
- No production setting, cap, schedule or package may be changed merely to
  manufacture a test result. No retry is created without explicit approval.
- No secrets, raw runtime logs, XML dumps or device screenshots belong in this
  checkpoint.

## PHYSICALLY VALIDATED IN PRODUCTION

- Natural scheduler request creation on the first eligible tick.
- Follow live and verified Like live projection during a physical Mythyl run.
- Warmup completed projection and limiting-source projection.
- `Mark reviewed` end to end, including Slack and Discord delivery.
- BotApp active-to-idle status transition from canonical request/run state.

## TEST-VALIDATED ONLY

- Scheduler launch while Electron BotApp is closed, with durable dispatcher and
  device heartbeats healthy.
- Bounded dispatcher concurrency and per-device/account/app-instance isolation.
- Same-account ready preflight lease handoff.
- Transactional Follow Settings persistence and cap hierarchy.
- Generic incident/action creation, state projection and notification
  idempotence for future structured failures.

## PENDING PHYSICAL OBSERVATION

- Two distinct phones executing business runs simultaneously.
- A natural scheduler launch with BotApp fully closed.
- Mythyl completing 20 follows with the new Follow resolver.
- Complete Tracker Welcome recovery, outbound bubble proof and Welcome-to-Follow
  handoff after the latest patches.

## KNOWN RISKS / LIMITS

- Old runner heartbeat rows can remain stale and must not be mistaken for a
  current business process.
- Some dispatcher heartbeat rows still report an unknown `git_sha`; release
  provenance must also be resolved from the active immutable root.
- The production deployment was created through the Vercel CLI; project and
  commit provenance must be checked together, not inferred from an alias alone.

## OPEN PERFORMANCE WORK AFTER JULY_16_PRODUCTION_BASELINE

The backend must not introduce synchronous calls into any of these worker paths:

1. Pre-Follow.
2. Post-Mute to post open.
3. CT stable to next candidate.

The Mythyl 2026-07-16 run is the physical baseline. Any backend projection or
persistence change affecting these paths requires line-by-line comparison and
must preserve identity, Story/Facebook, Like verification, Return CT and lease
safety.

`Any commit after this checkpoint touching these paths must be compared against JULY_16_PRODUCTION_BASELINE.`
