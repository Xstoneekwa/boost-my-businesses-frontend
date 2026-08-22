# Business Deadline transition projection V1

`account_session_transition_v1` is an informational projection of the existing
authoritative `ig_runs.performance_summary` termination envelope. It never
recalculates runtime decisions. A recognized
`follow_to_unfollow_time_handoff` produces one lifecycle identified by:

`business_session_id + attempt_id + generation + follow_to_unfollow_handoff`.

The lifecycle states are `initiated`, `no_work`, `blocked`, `partial`, and
`completed`. A normal handoff and an expected Unfollow window safe-stop do not
create incidents. `business_deadline` remains the transition context while a
real blocker, when present, is stored separately as `actionable_reason`.

The database trigger runs only on the already-existing run-summary write. It
adds no Worker network call, device RPC, XML dump, screenshot, Vision call, or
sleep. Admin and BotApp receive technical projection fields; client UX receives
business wording without runtime reason-code jargon.

## Deferred Unfollow roadmap

Stage B recalibration is deliberately deferred. A future, separately approved
Unfollow block must first consolidate S1, use S2/S3 only where genuinely
required, prove backlog-candidate correctness, remove already-unfollowed
candidates from Search Bar paths, consolidate cursor/resume behavior, reduce
unnecessary searches and terminalizations, then measure final Unfollow E2E
P50/P75/P90/P95. Only after that evidence may the Business Deadline reserve be
recalibrated. This document creates no Unfollow runtime change.
