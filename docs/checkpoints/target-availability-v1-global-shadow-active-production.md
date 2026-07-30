# Target Availability V1 — Global Shadow Active in Production

Date: 2026-07-31  
Activation boundary: `2026-07-30T22:38:00Z`  
Certification boundary: `2026-07-30T23:19:01Z`  
Status: **Global Shadow active and certified; all business actions remain disabled**

This checkpoint records the authorized global Shadow activation and its first natural production evidence. It authorizes no Lifecycle, enforcement, Premium replacement, notification, CT archive/delete, policy action, manual run, manual tick or phone action.

## 1. Production baselines

| Layer | Certified value |
|---|---|
| Backend production code | `b3016b8e7fc2f20ffbd53f558fd3575a64a8ad40` |
| Backend source/history head | `29ccb8d914e3082daab547c4a3eae8ab0acf6f35` before this documentary checkpoint |
| Vercel deployment | `dpl_24uGJan8JSZtFtKuWq8WX9XxJkUN`, `READY`, alias `www.boostmybusinesses.com` HTTP `200` |
| Production migration | `20260730221713_ct_target_availability_global_shadow_runtime_v1` |
| Target Availability Worker baseline | `f48ea58b5c65739063b79d1ced6265ae7fe78cf9` |
| Active Worker successor | `ff108bf386d5d6098cc68546d3a929449479d547` |
| Active release | `/Users/admin/phonefarm-worker-releases/ff108bf-rex-like-hotfix-v1` |
| Dispatcher | wrapper PID `25828`, consumer PID `25858`, one process, no duplicate |

`ff108bf` is a certified descendant of `f48ea58`. Its only Target Availability delta is the test-only isolation change in `tests/test_target_availability_runtime.py`; no Target Availability runtime or control file changed.

## 2. Activation sequence

The immutable `f48ea58` release was installed first with the runtime completely dormant and the kill switch present. One canonical dispatcher restart was performed at `2026-07-30T22:21:42Z–22:21:47Z`; its one-shot startup tick token was consumed with `cleanup_ok=true`.

After more than 14 minutes of stable operation, the final gate showed:

- process count `1`, duplicate `false`, exact release root;
- active requests `0`;
- active runs `0`;
- queue `0`;
- live device locks `0`;
- live tick locks `0`;
- natural Auto Restart ticks HTTP `200`, enqueue `0`;
- dormant DB state and kill switch still present.

Activation was then dynamic and restart-free:

1. the committed global active control was installed while the kill switch still blocked Worker capture;
2. the guarded DB singleton update changed configuration version `1` to `2`;
3. authenticated Backend status certified `active=true` and `side_effects=false`;
4. the kill switch was moved reversibly to `/Users/admin/phonefarm-runtime/control/target-availability-kill-switch.global-shadow-armed-20260730T2238Z`.

The coordinated Rex hotfix later performed its separately authorized single canonical restart at `2026-07-30T22:55:18Z–22:55:23Z`. Startup skip was consumed and cleaned. The active Shadow control and DB state were preserved.

## 3. Effective flags

Certified simultaneously in the Worker control file, DB runtime singleton and authenticated Backend status route:

| Control | State |
|---|---|
| Observation capture | ON |
| Writer | ON |
| Identity producer | ON |
| Assessment producer | ON |
| Current projector | ON |
| Availability Shadow | ON |
| Scope | `all_active_accounts` |
| Explicit allowlist | empty |
| Policy Shadow | OFF |
| Availability enforcement | OFF |
| Lifecycle | OFF |
| Replacement | OFF |
| Notifications | OFF |
| Archiving | OFF |

The canonical kill-switch path is absent by design while active. Its reversible backup is present. The auto-kill file is absent because no auto-kill occurred.

## 4. Natural production evidence

Two natural Rex account-session attempts were observed after activation. No run or tick was launched manually by this mission.

### First terminal run

- request: `15cc906c-d886-49f6-b818-0ab431588423`;
- run: `e71054f5-9a13-4fc3-834a-6cb43f0cb020`;
- account: `rex_gen_boost_ai`, `b024e94e-395d-4f02-9787-81ddc679b014`;
- tenant: `aefbca70-fc91-4be8-bc44-c7b8ad776272`;
- Target Availability observations created: `2`;
- checkpoints processed without error: `2`;
- terminal session status: `failed` because the Follow contract produced `partial_not_resumable`, exit `64`, stable reason `target_completed`.

The Follow failure occurred outside the Target Availability pipeline. Both Availability hooks completed, their DB errors/retries were zero, the session cleanup and request terminalization completed, and no Availability alert or auto-kill was raised.

### Second terminal run

- request: `e892381a-77d8-4947-b9ba-c1afa28807cc`;
- run: `c1d63950-31ee-4fe5-858f-bc3a604369a3`;
- Target Availability observation created: `1`;
- a real post-follow Like was tapped and verified with `visual_filled_heart_red_ratio_verify_post_tap_reuse`, confidence `0.92`;
- the device lock was released and the orphaned running row was reconciled to `stopped`;
- final runtime gate returned requests/runs/device locks/tick locks/queue `0`.

This second attempt supplies direct Golden Flow coexistence evidence: a real verified action completed while Global Shadow remained active and fail-open.

## 5. Data production

Activation baseline was `4 / 0 / 0 / 0 / 0` for Observations / Identity History / Identity Current / Assessments / Availability Current.

At certification:

| Store | Total | Created by Global Shadow |
|---|---:|---:|
| Observations | `7` | `3` |
| Identity History | `0` | `0` |
| Identity Current | `2` | `2` |
| Assessments | `3` | `3` |
| Availability Current | `2` | `2` |

Identity History correctly remained empty because neither run produced a proven username/stable-ID transition. Current identity rows remained `unresolved` / `insufficient_identity_evidence`, and Availability Current remained `insufficient_evidence`; no rename, quarantine or business decision was inferred from ambiguous evidence.

## 6. Integrity and isolation

Certification counters:

- errors/alerts `0`;
- retries `0`;
- duplicate idempotency keys `0`;
- out-of-order events `0`;
- cross-tenant attempts `0`;
- cross-tenant referential mismatches `0`;
- retained payload count `0`;
- lifecycle writes `0`;
- replacement writes `0`;
- DB errors `0`;
- rejected observations `0`.

All observations carry the canonical tenant/account/target relationship. Processor checkpoints are terminal `processed`, attempt `1`, error code `NULL`, processor release `ff108bf`.

No Lifecycle, replacement, notification, archive, deletion, enforcement or CT campaign mutation was performed.

## 7. Performance

Measured across the Global Shadow pipeline samples:

- latency p50: `1150.745 ms`;
- latency p95: `1167.927 ms`;
- latency maximum observed: `1167.927 ms`;
- configured pipeline budget: `1500 ms`;
- maximum measured pipeline CPU: `122.585 ms`;
- maximum measured memory growth: `2,973,696 bytes`;
- retained payload after processing: `0`;
- queue depth at processing: `1`;
- final dispatcher RSS: approximately `21,808 KiB`;
- final dispatcher process count `1`, duplicate `false`.

The p95 remained below the configured pipeline duration budget. No backlog, alert, auto-kill, duplicate process or restart loop appeared.

## 8. Golden Flow and adjacent systems

| Area | Certification |
|---|---|
| Golden Flow isolation | PASS — Availability hooks remained fail-open; one real Like was verified while active |
| Follow | No causal Availability regression; one independent Follow terminal-contract failure remains a separate incident |
| Unfollow | Not planned in the observed terminal run; no Availability dependency or regression observed |
| Resume | First run remained blocked by `unknown_resume_inputs`, independently of Availability |
| Auto Restart | Healthy natural ticks HTTP `200`; no manual tick, no unexpected enqueue |
| Backend | Authenticated runtime route active, no alerts, `side_effects=false` |
| Worker | Single healthy consumer on exact immutable release |

The independent Follow failure is not hidden or reclassified as a Target Availability success. It does not provide a causal reason to roll back the Shadow pipeline because the Availability hooks, projections, metrics and isolation gates all completed successfully.

## 9. Rollback readiness

Rollback was not triggered.

The reversible runtime rollback remains:

1. move the armed backup back to the canonical kill-switch path;
2. install the committed dormant control;
3. set the DB singleton producers, writer, capture and Shadow OFF with scope `off`;
4. retain valid observations and projections for audit;
5. perform no restart unless separately authorized and operationally required.

The auto-kill contract remains available for repeated critical errors, latency breach, cross-tenant mismatch, duplicate/partial write, Golden Flow regression or projection inconsistency.

## 10. Final report fields

| Field | Value |
|---|---|
| `GLOBAL_SHADOW_STATUS` | `ACTIVE` |
| `IDENTITY_PRODUCER_STATUS` | `ACTIVE` |
| `ASSESSMENT_PRODUCER_STATUS` | `ACTIVE` |
| `CURRENT_PROJECTOR_STATUS` | `ACTIVE` |
| `OBSERVATIONS_CREATED` | `3` |
| `IDENTITY_HISTORY_ROWS` | `0` |
| `IDENTITY_CURRENT_ROWS` | `2` |
| `ASSESSMENTS_ROWS` | `3` |
| `CURRENT_ROWS` | `2` |
| `LATENCY_P50` | `1150.745 ms` |
| `LATENCY_P95` | `1167.927 ms` |
| `CPU_IMPACT` | max pipeline `122.585 ms`; no sustained dispatcher saturation |
| `MEMORY_IMPACT` | max pipeline growth `2,973,696 bytes`; retained payload `0` |
| `DB_IMPACT` | bounded additive Shadow rows only; no business-action writes |
| `GOLDEN_FLOW_STATUS` | `PASS_WITH_INDEPENDENT_FOLLOW_INCIDENT_DISCLOSED` |
| `FOLLOW_STATUS` | no causal TA regression; independent exit `64` incident remains |
| `UNFOLLOW_STATUS` | not planned; no TA regression observed |
| `RESUME_STATUS` | blocked by independent `unknown_resume_inputs` on first run |
| `AUTO_RESTART_STATUS` | healthy natural ticks, no unexpected enqueue |
| `ERROR_COUNT` | `0` |
| `RETRY_COUNT` | `0` |
| `DUPLICATE_COUNT` | `0` |
| `OUT_OF_ORDER_COUNT` | `0` |
| `CROSS_TENANT_COUNT` | `0` |
| `ROLLBACK_TRIGGERED` | `false` |
| `NEXT_PHASE_RECOMMENDATION` | `TARGET LIFECYCLE`, under a separate explicit GO |
| `NEXT_STEP_AUTHORIZED` | `false` |

## 11. Verdict

**GO — TARGET AVAILABILITY V1 ACTIVE GLOBALLY IN PRODUCTION**

Global Shadow is producing observations, identity state, assessments and current availability projections across the canonical all-active-accounts scope. Its writers are bounded, deterministic and tenant-safe. No business action is enabled. The next architectural phase is Target Lifecycle, but this checkpoint grants no authorization to start or activate it.

