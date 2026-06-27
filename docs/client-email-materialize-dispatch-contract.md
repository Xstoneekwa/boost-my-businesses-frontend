# Client email — Materialize / Dispatch contract (TASK 11B)

**Status:** design-only, not implemented.  
**Database:** main production only (`zgafnshkjywfltxgbtzg`).  
**Scope:** locks the future writer/dispatcher contract before any migration or runtime code.

This document corrects ambiguities identified in TASK 11A. It does **not** activate automation, dispatch, or provider sends.

---

## 1. Canonical categories (verified)

### 1.1 Lifecycle episode categories

The only values allowed for `client_email_lifecycle_episodes.category` are:

| Value | Verified in |
|-------|-------------|
| `account_paused` | migration `20260630120000_client_email_lifecycle_episodes.sql` CHECK |
| `account_canceled` | same |
| `needs_assistance` | same |

Same three values appear in:

- `client-email-lifecycle-contract.ts` (`CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES`)
- `client-email-intent-parent-contract.ts`
- intent parent CHECK (`20260702120000_client_email_intent_episode_links.sql`)
- planner, precedence, templates, previews, tests

### 1.2 Verdict: `account_paused` vs `account_papaused`

**Verdict A — report typo only.**

- Grep across `boost-ai-frontend`, `instagram-worker-python`, migrations, docs: **zero** occurrences of `account_papaused`.
- DB CHECK, code, tests, and existing docs use **`account_paused`** consistently.
- TASK 11A report contained a transcription error only. **No corrective migration required.**

### 1.3 Template / intent categories (four total)

`client_email_templates.category` and `client_email_send_intents.category` additionally include:

- `needs_more_target_accounts` (parent = `client_email_needs_more_targets_sequences`, not lifecycle episodes)

---

## 2. Three independent layers

```
┌─────────────────────────────────────────────────────────────────┐
│  PLANNER / PREVIEW — read-only, zero writes                     │
│  buildClientEmailLifecycleOutboxPlan → precedence → outbox API  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ effective candidate (theoretical)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  MATERIALIZE — future writer (episodes/sequences + intents)     │
│  Gates: automation + watermark + category + business validity   │
│  NEVER depends on CLIENT_EMAIL_SENDING_ENABLED                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ durable intent (pending/scheduled)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  DISPATCH — future worker (claim → revalidate → Postmark)       │
│  ONLY layer that may call Postmark for client lifecycle         │
│  REQUIRES CLIENT_EMAIL_SENDING_ENABLED=true                     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ provider_message_id + webhook events
                                ▼
                         Email History (read)
```

### 2.1 Gate split in preview/planner (TASK 11C)

`resolveDeliveryGateDecision()` was removed from the outbox planner. Business decisions such as `would_create_initial_intent` are no longer replaced by `blocked_delivery_gate` when `CLIENT_EMAIL_SENDING_ENABLED=false`.

Preview and readiness now expose separate materialization vs dispatch eligibility via `client-email-lifecycle-outbox-gates.ts`.

---

## 3. Gates by layer

### 3.1 Planner / Preview (read-only)

**Purpose:** explain what would happen; never persist.

| Signal | Used for preview? | Notes |
|--------|-------------------|-------|
| Precedence V1 | yes | One effective candidate per account |
| Watermarks (`*_AUTOMATION_ENABLED_AT`) | yes | `blocked_legacy_pre_watermark` vs post-watermark |
| Canonical client email | yes | `blocked_missing_client_email` |
| Active template | yes | `blocked_template_unavailable` |
| Category automation flags | yes | `CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED`, `CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED` |
| Category watermarks | yes | separate lifecycle vs needs-more timestamps |
| Parent / business rules | yes | episode open, stop reasons, CT threshold |
| **`CLIENT_EMAIL_SENDING_ENABLED`** | **no (target contract)** | Must not block “would materialize”; may appear as separate **dispatch readiness** field |
| Postmark token / provider | **no (target contract)** | Informational in readiness only |
| Idempotency existing keys | yes (read) | `no_action` if key exists |

**Outputs:** raw observations, effective candidates, suppressed-by-precedence, theoretical dispatch readiness (dispatch layer only).

**Kill switches:** none required — preview always allowed for relay/admin.

---

### 3.2 Materialize (future writer)

**Purpose:** create or retrieve episode/sequence + exactly one durable intent per business event.

**Allowed when ALL true:**

| Gate | Source |
|------|--------|
| Global category automation enabled | `CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED` or `CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED` |
| Category watermark configured | `CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT` or `CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT` |
| Effective outbox candidate wins precedence | precedence module |
| Canonical client email resolved | `resolveClientCommunicationEmail()` |
| Active template for category | `client_email_templates` status=active |
| Parent business validity | episode/sequence rules, anti-backfill, stop reasons |
| Idempotency key not already present | UNIQUE `client_email_send_intents.idempotency_key` |
| Intent parent contract satisfied | `validateClientEmailIntentParentRefs()` |
| Materialize master switch (future) | e.g. `CLIENT_EMAIL_MATERIALIZE_ENABLED=true` |

**Must NOT depend on:**

- `CLIENT_EMAIL_SENDING_ENABLED`
- Postmark HTTP reachability
- `POSTMARK_SERVER_TOKEN` (configuration may be probed for readiness UX, not as a materialize blocker)

**Controlled mode (future activation step):**

```text
CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED=true
CLIENT_EMAIL_MATERIALIZE_ENABLED=true
CLIENT_EMAIL_SENDING_ENABLED=false
→ episodes/sequences/intents persisted as pending/scheduled
→ zero Postmark calls
```

**Kill switches:**

- `CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED=false`
- `CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED=false`
- `CLIENT_EMAIL_MATERIALIZE_ENABLED=false` (proposed)
- Remove / do not set watermarks

---

### 3.3 Dispatch (future worker)

**Purpose:** claim a ready intent, revalidate, call Postmark once, persist provider correlation.

**Allowed when ALL true:**

| Gate | Source |
|------|--------|
| **`CLIENT_EMAIL_SENDING_ENABLED=true`** | `evaluateClientEmailSendingGate()` |
| Provider configured | `CLIENT_EMAIL_PROVIDER=postmark`, token present |
| Category automation still enabled | same flags as materialize |
| Intent claimed exclusively | future claim columns |
| Final revalidation passed | live account/episode/precedence checks |
| `intent_kind=client` | never dispatch test intents via this worker |
| `status IN (pending, scheduled)` | not sent/canceled/failed |
| `provider_message_id IS NULL` | no prior accepted send recorded |
| No known provider result | no `sent` delivery event, no reconciled MessageID |
| `scheduled_for IS NULL OR scheduled_for <= now()` | scheduler |

**Kill switches:**

- `CLIENT_EMAIL_SENDING_ENABLED=false` (immediate stop of new provider calls)
- Category automation flags off (cancel pending dispatch, do not send)
- `CLIENT_EMAIL_DISPATCH_ENABLED=false` (proposed fine-grained switch)

**Test delivery path (unchanged, separate):**

- Route: `POST /api/instagram-dashboard/email-test-delivery`
- Gate: `CLIENT_EMAIL_TEST_SENDING_ENABLED` + allowlisted `CLIENT_EMAIL_TEST_RECIPIENT`
- Does **not** use `CLIENT_EMAIL_SENDING_ENABLED`
- `intent_kind=test`, `trigger=manual_test`, no parent FK
- Not affected by this contract’s client dispatch worker

---

## 4. Materialize transaction contract

### 4.0 Materialize RPC (TASK 13A / hardened 13B — applied main prod; sender fix 13E)

**Local migrations:**

- `supabase/migrations/20260704120000_client_email_materialize_outbox_rpc.sql` — applied remote `20260627135913`
- `supabase/migrations/20260705120000_client_email_materialize_from_email_consistency.sql` — applied remote `20260627160044`

**Function:** `materialize_client_email_outbox_candidate_v1(...)`

**Server module (no route):** `lib/instagram-dashboard/client-email-outbox-materializer.ts`

| Concern | Contract |
|---------|----------|
| **Purpose** | Atomically open parent episode/sequence and/or insert one `pending` client intent with immutable snapshots |
| **Strict operations** | Lifecycle: `open_lifecycle_episode`, `create_lifecycle_initial_intent` · Needs-more: `open_needs_more_sequence`, `create_needs_more_initial_intent`, `create_needs_more_reminder_intent` |
| **Lock** | `pg_advisory_xact_lock(hashtext('client_email_materialize'), hashtext(account_id))` before ownership/parent/intent decisions |
| **Ownership** | `public.client_instagram_accounts` canonical link (`account_id` UNIQUE, `(client_id, account_id)` UNIQUE) — mismatch → `client_email_account_client_ownership_mismatch` |
| **Initial status** | Always `pending` for new intents |
| **Idempotency key** | `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` then business-identity assertion |
| **Business identity** | Compare on conflict: `account_id`, `client_id`, `intent_kind='client'`, `category`, `trigger`, `reminder_index`, parent FK (`sequence_id` or `lifecycle_episode_id`) |
| **Identity vs snapshots** | Snapshots are **not** compared on conflict — existing intent keeps historical rendered subject/body/sender/support even if templates changed |
| **Identity conflict** | Same key + different business identity → `RAISE EXCEPTION 'client_email_idempotency_identity_conflict'` → full transaction rollback |
| **Lifecycle V1** | Initial only (`reminder_index=0`); no lifecycle reminders materialized |
| **Needs-more V1** | Index `0` initial · indexes `1..5` reminders · reminder requires active sequence · reminder never opens a new sequence |
| **Parent reopen** | Closed/resolved/canceled episode or sequence never reopened — `parent_episode_not_reopenable` |
| **Snapshots** | Written once at first insert only |
| **Sender consistency (13E)** | On create-intent operations: `p_from_email` and `p_from_email_snapshot` must be non-null/non-empty after `btrim` and strictly equal after `btrim` — missing → `RAISE EXCEPTION` `client_email_from_email_snapshot_missing`; mismatch → `client_email_from_email_snapshot_mismatch` (`ERRCODE P0001`) before any parent/intent INSERT |
| **Excluded** | claim/lease, dispatch, `provider_message_id`, Postmark, webhooks, cron, triggers |
| **Security** | `SECURITY DEFINER`, `SET search_path = public, pg_temp`, fully qualified `public.*` tables, `REVOKE ALL` from `PUBLIC`/`anon`/`authenticated`, `GRANT EXECUTE` to `service_role` only |
| **Output** | Minimal ids/status only — no recipient, body, credentials, or template HTML |

#### Idempotency identity (immutable business key)

| Field | Included in identity assert? |
|-------|------------------------------|
| `account_id` | yes |
| `client_id` | yes |
| `intent_kind` | yes (`client`) |
| `category` | yes |
| `trigger` | yes |
| `reminder_index` | yes |
| `sequence_id` / `lifecycle_episode_id` | yes |
| `snapshot_subject/body/from/support/recipient` | **no** |

#### Strict operation matrix

| Category | Allowed `p_operation` | Reminder index |
|----------|----------------------|----------------|
| lifecycle | `open_lifecycle_episode`, `create_lifecycle_initial_intent` | `0` only |
| needs-more | `open_needs_more_sequence`, `create_needs_more_initial_intent`, `create_needs_more_reminder_intent` | `0` initial · `1..5` reminder |

#### Transaction / rollback rules

1. Advisory lock first.
2. Ownership check before parent/intent writes.
3. If idempotency key already exists: identity assert **before** parent creation when possible; on mismatch → exception rollback.
4. Parent + intent in one transaction; no internal `COMMIT`.
5. No `EXCEPTION WHEN OTHERS` swallowing business failures.

#### TypeScript layers

| Function | Role |
|----------|------|
| `buildMaterializeCandidateCommand(...)` | Pure preparation — separates `businessIdentity` from frozen `intentSnapshot` |
| `buildMaterializeIntentBusinessIdentity(...)` | Explicit immutable identity payload for SQL assert |
| `validateMaterializeEffectiveCandidate(...)` | Gates, precedence, strict operation/index rules |
| `materializeClientEmailOutboxCandidateInternal(...)` | **Internal-only** RPC caller |

`CLIENT_EMAIL_SENDING_ENABLED=false` does **not** block Materialize.

**Blocking precondition before apply:** migration draft assumes `public.client_instagram_accounts` exists on main prod (verified). Without it, do not apply.

**Restriction:** no POST route, no scheduler, no provider call.

### 4.1 Preconditions (re-checked inside transaction)

1. Advisory lock or `SELECT … FOR UPDATE` on account (or active episode row).
2. Re-run precedence for account — abort if candidate superseded.
3. Re-read lifecycle status / needs-more signal / watermark eligibility.
4. Confirm idempotency key still absent (or return existing intent id).

### 4.2 Steps (single DB transaction)

```text
BEGIN
  -- optional: open lifecycle episode or needs-more sequence
  INSERT … ON CONFLICT (episode_key) DO NOTHING / retrieve
  -- create intent
  INSERT client_email_send_intents (…)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  -- if conflict: SELECT existing id, COMMIT no-op
  -- link parent: sequence_id OR lifecycle_episode_id (mutually exclusive)
  -- snapshot immutable fields at insert time (see §7)
COMMIT
```

### 4.3 Idempotency keys (stable, already defined in planner)

| Category | Key pattern |
|----------|-------------|
| Lifecycle | `lifecycle:{category}:{accountId}:episode:{episodeId}:index:{reminderIndex}` |
| Needs-more | `needs_more_targets:{accountId}:episode:{episodeId}:index:{reminderIndex}` |

**Guarantee:** DB UNIQUE on `idempotency_key` prevents duplicate intents for the same business send.

### 4.4 Parent rules

| Category | Parent table | FK column |
|----------|--------------|-----------|
| `account_paused`, `account_canceled`, `needs_assistance` | `client_email_lifecycle_episodes` | `lifecycle_episode_id` |
| `needs_more_target_accounts` | `client_email_needs_more_targets_sequences` | `sequence_id` |

Constraints: `client_email_send_intents_parent_exclusivity`, `client_email_send_intents_client_parent_requires_refs`.

### 4.5 Materialize outcomes

| Result | Intent | Episode |
|--------|--------|---------|
| Created | `status=pending` or `scheduled` | opened/updated |
| Idempotent hit | existing row returned | unchanged |
| Blocked | none | none |
| Superseded by precedence | none | none |

### 4.6 Shadow Materialization Runner (TASK 14B — shadow only)

**Module:** `lib/instagram-dashboard/client-email-materialization-runner.ts`

| Layer | Function | Role |
|-------|----------|------|
| Pure plan | `buildClientEmailMaterializationRunPlan(...)` | Maps **effective candidates only** to would-materialize vs skipped items with strict operation, parent type, category, trigger, reminder index, skip codes — **no I/O** |
| Shadow loader | `planClientEmailMaterializationShadowRun(...)` | Reuses canonical planner + precedence + gate enrichment; returns safe summary envelope |

#### Shadow vs RPC execute

| Concern | Shadow runner | RPC `materialize_client_email_outbox_candidate_v1` |
|---------|---------------|-----------------------------------------------------|
| Writes DB | **never** | transactional parent + intent insert |
| Invokes RPC | **never** (`rpcInvoked: false`) | yes (internal caller only) |
| Postmark / dispatch | **never** | still excluded at materialize layer |
| Output | redacted plan items + counts | minimal ids/status jsonb |
| HTTP route | **none** (dormant) | **none** today |

#### Shadow envelope (always)

- `executionMode: "shadow"`
- `readOnly: true`
- `mutationExecuted: false`
- `rpcInvoked: false`
- Counts: `rawObservations`, `effectiveCandidates`, `suppressedByPrecedence`, `wouldMaterialize`, `skipped`, `skippedByCategory`
- Items: masked email only, no UUID/account/client ids, no template body/HTML, no sender/support full values

#### Exclusions (same as production planner)

- Raw observations not listed as plan items
- Precedence-suppressed candidates never in effective input
- Non-`materializationEligible` rows → skipped with gate/watermark/automation reason
- `CLIENT_EMAIL_SENDING_ENABLED=false` does **not** block shadow would-materialize
- Legacy pre-watermark replay never planned

#### Future activation (separate task + explicit GO)

Shadow → execute requires **all** of:

1. `CLIENT_EMAIL_MATERIALIZE_ENABLED=true` (future gate, not in 14B)
2. Watermarks configured per category
3. Category automation enabled
4. Explicit GO on a dedicated write task
5. Internal caller wiring — **not** a public POST route

**14B restriction:** no route, no scheduler, no RPC call, no Vercel env changes, no BotApp.

---

## 5. Dispatch claim, lease, and state machine (TASK 12A draft)

**Local migration (not applied):** `supabase/migrations/20260703120000_client_email_dispatch_claim_state.sql`

### 5.1 Schema additions on `client_email_send_intents`

| Column | Purpose |
|--------|---------|
| `status` extended | adds `claimed`, `dispatch_uncertain` to existing `pending`, `scheduled`, `sent`, `canceled`, `failed` |
| `claimed_at` | claim timestamp |
| `claim_token` | opaque UUID lease (never provider secret) |
| `claim_expires_at` | lease expiry |
| `dispatch_attempt_count` | bounded 0–8 |
| `dispatch_last_attempt_at` | last attempt timestamp |
| `dispatch_last_error_code` | stable redacted error code |
| `dispatch_uncertain_at` | ambiguous provider outcome timestamp |
| `provider_accepted_at` | provider acceptance recorded (distinct from `sent_at` when needed) |
| `provider_message_id` | **already exists** — unique partial index added |

`client_email_delivery_events` unchanged. Webhook dedupe remains `webhook_event_id` partial unique.

### 5.2 State transition matrix

| From | To | Condition | Auto? |
|------|-----|-----------|-------|
| `pending` / `scheduled` | `claimed` | atomic claim wins lease; `provider_message_id` null | worker |
| `claimed` | `sent` | HTTP success with MessageID or webhook reconciliation | worker / webhook |
| `claimed` | `pending` / `scheduled` | deterministic failure before acceptance; retry allowed; clear lease; increment attempt count | worker |
| `claimed` | `failed` | deterministic failure; max attempts exceeded | worker |
| `claimed` | `dispatch_uncertain` | timeout / ambiguous network / no reliable MessageID | worker |
| `dispatch_uncertain` | `sent` | correlated webhook Delivery with `Metadata.intent_id` + MessageID | webhook |
| `dispatch_uncertain` | `canceled` | human reconciliation or safe cancel decision | ops |
| `pending` / `scheduled` / `claimed` | `canceled` | final revalidation failure | worker |
| `dispatch_uncertain` | `pending` | **never** | forbidden |
| any with known `provider_message_id` | resend | **never** | forbidden |
| any with provider delivery event | auto retry | **never** | forbidden |

### 5.3 Claim / lease strategy

```text
1. SELECT candidate intent (pending/scheduled, client kind, no provider_message_id).
2. UPDATE … SET status=claimed, claim_token=:uuid, claimed_at=now(),
   claim_expires_at=now()+lease, dispatch_attempt_count+=1
   WHERE id=:id AND status IN ('pending','scheduled')
     AND provider_message_id IS NULL
     AND (claim_token IS NULL OR claim_expires_at < now())
   RETURNING *;
3. Only holder of claim_token may finalize send or release lease.
4. Reclaim after lease expiry requires full final revalidation — never blind retry.
5. Worker crash: lease expires; another worker may reclaim ONLY if still pending-eligible
   and outcome was NOT dispatch_uncertain.
6. dispatch_uncertain: no automatic reclaim as pending; wait webhook or human ops.
```

### 5.4 Historical test intent compatibility

Production rows (`intent_kind=test`, `status=sent`, `provider_message_id` set):

- satisfy new CHECK constraints with null claim fields;
- `dispatch_attempt_count` defaults to 0;
- unique `provider_message_id` index allows both historical MessageIDs;
- no data migration UPDATE required.

### 5.5 Claim (future worker SQL reference)

```sql
UPDATE client_email_send_intents
SET claimed_at = now(),
    claim_token = :token,
    claim_expires_at = now() + interval '5 minutes',
    dispatch_attempt_count = dispatch_attempt_count + 1
WHERE id = :id
  AND status IN ('pending','scheduled')
  AND provider_message_id IS NULL
  AND (claimed_at IS NULL OR claim_expires_at < now())
RETURNING *;
```

Only one worker wins. Expired claims may be taken by another worker after revalidation.

### 5.6 Final revalidation (post-claim, pre-Postmark)

Re-read live state:

1. Account lifecycle status vs intent category (cancel dispatch if invalid).
2. Parent episode/sequence still `active` (or allowed terminal path for cancel emails).
3. Needs-more: signal active, CT ≤ threshold, not stopped.
4. Precedence: no higher-priority lifecycle state now active for account.
5. Gates: dispatch layer only (`CLIENT_EMAIL_SENDING_ENABLED`, provider token).
6. Recipient snapshot still valid shape (optional mismatch → cancel).

Failure → `status=canceled`, `resolved_at=now()`, structured reason — **no Postmark call**.

### 5.7 Immutable snapshots at dispatch

Dispatch MUST send using **intent row snapshots only**:

- `recipient_email`, `snapshot_subject`, `snapshot_body_text`, `snapshot_body_html`
- `from_email` / `from_email_snapshot`, `support_email_snapshot`
- `template_id`, `template_version`

Live changes to templates or `transactional_email_delivery_settings` MUST NOT alter an existing intent.

---

## 6. Provider outcomes without unproven lookup

### 6.1 What exists today (code audit)

| Capability | Present? |
|------------|----------|
| HTTP POST send (`/email`) | yes — test path `executePostmarkTestDeliverySend()` |
| Client adapter wired | **no** — `createPostmarkClientEmailAdapter().send()` returns `sending_disabled` |
| Outbound Metadata `intent_id` | yes — prepared in adapter/test send |
| Inbound webhook correlation by `Metadata.intent_id` | yes — `ingestPostmarkWebhookEvent()` |
| Provider search by Metadata / intent id | **no code, not assumed** |
| Postmark-native idempotency key on send | **not used** |

**Rule:** retry and reconciliation logic MUST work **without** provider-side lookup until a separate spike validates an official API and it is implemented.

### 6.2 Outcome matrix

#### A. HTTP success with `MessageID`

```text
UPDATE intent: status=sent, sent_at, provider_message_id=MessageID
Release claim
Delivery events: webhook inserts delivered/bounced/etc. (deduped)
```

Optional (future): insert `delivery_events.status=sent` at accept time — not required if webhook is trusted.

#### B. Deterministic HTTP failure before acceptance

Examples: 4xx validation, 401, explicit Postmark error JSON, connection refused before response body.

```text
IF dispatch_attempt_count < MAX AND error classified retryable:
  status remains pending/scheduled, release claim, backoff
ELSE:
  status=failed, last_error_redacted, resolved_at
```

Safe to retry only when **all** are true:

- `provider_message_id IS NULL`
- no `delivery_events` row with `provider_message_id` for this intent
- intent not `dispatch_uncertain`

#### C. Timeout / ambiguous response (no reliable MessageID)

Examples: socket timeout, connection reset after request sent, empty body, HTTP 5xx without MessageID.

```text
NEVER immediate automatic retry
SET status=dispatch_uncertain (proposed new intent status)
KEEP claim metadata + dispatch_attempt_count for audit
WAIT reconciliation window (proposed: 15–30 minutes)
```

Reconciliation without provider lookup:

1. **Webhook wins:** if Delivery/Bounce webhook arrives with `Metadata.intent_id` and `MessageID`:
   - persist `provider_message_id`
   - promote intent `sent` (or `failed` on hard bounce)
   - insert delivery event (existing dedupe)
2. **Window expires with no webhook:** escalate human ops — manual check in Postmark UI or deliberate decision to cancel intent. **Do not auto-resend.**
3. **Future optional:** if Postmark search API is validated in a separate task, it may be added as an explicit reconciliation tool — not a default retry path.

#### D. Webhook arrives before local “sent” persistence

Current handler behavior (`ingestPostmarkWebhookEvent`):

1. Dedupe by `webhook_event_id` (UNIQUE partial index).
2. Require `Metadata.intent_id` — ignores if missing.
3. Load intent by primary key — fails if intent never materialized.
4. Insert `client_email_delivery_events` — does **not** update intent status today.

**Required future tolerance:**

```text
ON webhook Delivery for intent_id:
  IF intent.status IN (pending, scheduled, dispatch_uncertain):
    SET provider_message_id = webhook MessageID (if null)
    SET status = sent, sent_at = coalesce(sent_at, occurred_at)
  INSERT delivery_event (idempotent webhook_event_id)
```

This closes the race where Postmark accepts and webhooks faster than dispatch worker UPDATE.

Duplicate webhook: existing `webhook_event_id` check → `action=duplicate`, no second event.

---

## 7. Retries summary

| Situation | Auto retry? |
|-----------|-------------|
| Pre-acceptance deterministic failure | yes, bounded, with backoff |
| Timeout / ambiguous | **no** → `dispatch_uncertain` + wait webhook |
| `provider_message_id` already set | **no** |
| Delivery event exists for intent | **no** |
| Webhook duplicate | **no** (deduped) |
| Account canceled after materialize | cancel intent, no send |
| Two workers same intent | claim prevents double send |

---

## 8. Audit logs (structured)

Each materialize and dispatch attempt SHOULD emit:

| Field | Example |
|-------|---------|
| `phase` | `materialize` / `dispatch` / `dispatch_reconcile` |
| `account_id` | uuid |
| `intent_id` | uuid |
| `category` | `account_paused` |
| `idempotency_key` | stable key |
| `decision` | `created` / `idempotent_hit` / `canceled` / `sent` / `dispatch_uncertain` |
| `failure_reason` | stable enum string |
| `run_id` / `worker_id` | dispatcher correlation |

No secrets, template bodies, or full emails in logs.

---

## 9. Future activation order (unchanged from 11A, gated by this contract)

1. Migration: claim columns + optional `dispatch_uncertain` status (or flag).
2. Migration: split gate helpers — materialize gate without `CLIENT_EMAIL_SENDING_ENABLED`.
3. Refactor preview/planner to separate materialize vs dispatch readiness.
4. Deploy materialize writer with `CLIENT_EMAIL_MATERIALIZE_ENABLED=false`.
5. Preview confirms effective candidates.
6. Configure watermarks explicitly.
7. Shadow / dry-run materialize logging — **`client-email-materialization-runner.ts` deployed shadow-only (TASK 14B)**.
8. `CLIENT_EMAIL_MATERIALIZE_ENABLED=true`, `CLIENT_EMAIL_SENDING_ENABLED=false` — persist intents only.
9. Internal isolated dispatch test (single account, sending true briefly).
10. Enable one category end-to-end.
11. Enable dispatch worker globally.
12. Scheduler last, after timed sends proven.

---

## 10. Proposed future migrations / code (not in this task)

| Item | Type | Status |
|------|------|--------|
| Claim columns + dispatch statuses (`20260703120000_client_email_dispatch_claim_state.sql`) | migration | **applied main prod `20260627132254`** |
| Materialize RPC (`20260704120000_client_email_materialize_outbox_rpc.sql`) | migration | **applied main prod `20260627135913`** |
| Sender consistency (`20260705120000_client_email_materialize_from_email_consistency.sql`) | migration | **applied main prod `20260627160044`** |
| `client-email-outbox-materializer.ts` | code | **recorded TASK 13D — no route, not invoked** |
| `client-email-materialization-runner.ts` | code | **shadow-only TASK 14B — no route, no RPC, no writes** |
| Split gate helpers — materialize vs dispatch | code | done TASK 11C |
| `client-email-outbox-materialize.ts` | code | pending (RPC wiring + activation) |
| `client-email-outbox-dispatch.ts` | code | pending |
| Wire `createPostmarkClientEmailAdapter().send()` | code | pending |
| Webhook intent status reconciliation | code | pending |
| Scheduler worker | code | pending |

---

## 11. Validation checklist (TASK 11B read-only)

| # | Check | Result |
|---|-------|--------|
| 1 | Category values DB/code | **`account_paused`** only; `account_papaused` absent everywhere |
| 2 | Preview possible with gates closed | **yes** — outbox-preview API read-only works today |
| 3 | Materialize conceptually allowed with sending false | **yes** per this contract; **requires gate refactor** (§2.1) |
| 4 | Dispatch only layer needing sending true | **yes** per this contract; test path uses separate test gate |
| 5 | Test delivery path unchanged | **yes** — no edits in this task |
| 6 | Webhook dedupes `webhook_event_id` | **yes** — `ingestPostmarkWebhookEvent()` |
| 7 | No unproven provider lookup as guarantee | **yes** — §6.1 explicit; reconciliation is webhook-first |

---

## 12. References

- `docs/client-email-postmark.md` — gates, test delivery, webhooks
- `docs/client-email-lifecycle-episodes.md` — lifecycle categories and anti-backfill
- `lib/instagram-dashboard/client-email-lifecycle-outbox-precedence.ts` — precedence V1
- `lib/instagram-dashboard/client-email-intent-parent-contract.ts` — parent FK rules
- TASK 11A audit — superseded on gate separation and provider lookup assumptions

---

*Document created TASK 11B — design only. No runtime activation.*
