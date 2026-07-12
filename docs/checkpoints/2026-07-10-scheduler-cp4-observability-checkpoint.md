# Scheduler / CP4 / Preflight / BotApp Observability — Interim Checkpoint

```text
Status: FINAL DOCUMENTED CHECKPOINT — runtime positive path still pending.
```

**Checkpoint date (UTC+2):** 2026-07-10 ~17:00
**Scope:** Daily Scheduler + CP4 preflight hardening + BotApp pipeline observability
**Language:** operator UI remains English-only (BotApp)

**Final documentation update (UTC+2):** 2026-07-13
**Backend commit documented:** `61d6ccfc334ba084ff73f57b685c7f637e948faa`
(`fix(botapp): project active device runs and ignore stale blockers`)
**Production deployment documented:** `dpl_4yJbW11sJ4MwoDoz164xYrHvLmMd`,
READY on `www.boostmybusinesses.com`.

---

## 0. Chronologie finale du checkpoint 2026-07-12/13

1. **Worker integrity incident diagnosed** —
   `instagram_navigation.py` was found truncated before any functional patch.
2. **Forensic backups + targeted restore tested** — truncated file and full diff
   saved under `/tmp/instagram_navigation.py.truncated.<timestamp>*`, then only
   `instagram_navigation.py` restored from verified `HEAD`.
3. **Return CT ambiguous own_unified patched** — worker commit
   `26cd04cd816c8b358397e5e9d4224360fb5ea54f` reuses `post_back_det` after
   `compact_safe_back` and concludes `compact_safe_back_then_list`.
4. **Golden Flow tests passed** — worker py_compile, Return CT targeted test,
   Golden Flow tests and worker validation completed without device run.
5. **Tracker preflight repairs diagnosed / patched** — stale/technical blockers
   were separated from real Instagram challenge/checkpoint/identity blockers.
6. **Mythyl stale scheduler blockers resolved** — old resolved blockers no
   longer project as active scheduler/UI blocking state.
7. **Expired device lock cleanup canonicalized** — stale device lock cleanup kept
   scoped to canonical lock release; no schedule/caps/package changes.
8. **Device Busy projection patched** — active request/run now projects device
   Busy accurately instead of relying on stale local state.
9. **Historical blocker projection patched** — backend projection ignores stale
   resolved blockers while preserving current `blocking_campaign=true` blockers.
10. **Backend deployed** — deployment `dpl_4yJbW11sJ4MwoDoz164xYrHvLmMd` is
    READY on `www.boostmybusinesses.com`.
11. **BotApp stale state cleared operationally** — Cmd+Q + one reopen cleared
    stale packaged state before the final BotApp patch/install.
12. **Tracker `operator_review_required` diagnosed** — current active action is
    operator-facing, critical, and tied to
    `scheduled_retry_not_claimed_before_deadline`.
13. **Verdict:** `TRACKER_NATURAL_WINDOW_ELIGIBLE` — the action does not block
    natural scheduler creation/claim because scheduler eligibility only hard
    blocks credential, checkpoint and identity-mismatch action classes.
14. **BotApp social fallback patched** — `operator_review_required` maps to
    `operator review required`, never `social blocked: reason required`.
15. **BotApp Account Auto Restart status added** — one synthesis row per active
    scheduled account.
16. **Recent Auto Restart decisions kept separate** — multiple historical
    decisions remain under `Recent Auto Restart decisions`, not in the account
    synthesis rows.
17. **Official BotApp built/package/installed** — BotApp commit
    `dcbb85e9a1c9cad9f1a8a49eae9cf1f7e502206d` packaged from clean source and
    installed to `/Applications/BotApp.app`.
18. **Official smoke succeeded** — relay operational, dispatcher active,
    Profiles/Devices loaded, Tracker shows `operator review required`, Mythyl
    shows `growth ready`, Scheduler shows both accounts and separate history.
19. **Runtime validations pending** — the next natural Welcome/session runtime
    validation is not completed by this documentation checkpoint.

Deployment operator incident recorded: an earlier Vercel deploy attempt targeted
the wrong project and was corrected before the production READY deployment above.
Do not reuse that wrong-project event as production evidence; no sensitive URL,
token or credential is documented here.

---

## 1. État global actuel

| Signal | État observé |
|--------|----------------|
| Scheduler global | **ON** (`auto_restart_settings.auto_restart_enabled=true`) |
| Daily engine `dry_run` | **false** (enqueue réel autorisé quand gates passent) |
| BotApp runtime gate | **passing** (heartbeat `botapp-scheduler-runtime:{host}` frais) |
| Dispatcher canonique | `run-dispatcher:mac-admin-01` |
| No blind start | **strictement préservé** — pas de `account_session` sans `preflight_ready` |
| Comptes programmés (growth) | `mythyl_fitness` **12:00–18:00** ; `i_m_your_traker` **18:00–00:00** |

**Clarification Auto Restart vs Daily Scheduler**

- `resume_plan_missing` dans **Auto Restart Recent decisions** = bruit Auto Restart (pas d’échec Daily Scheduler).
- L’ancienne vue « Runs enqueued (24h) » reflétait surtout Auto Restart, pas les tentatives Daily Scheduler complètes.

---

## 2. Corrections backend / CP4 (boost-ai-frontend)

### Final backend projection patch

- Commit:
  `61d6ccfc334ba084ff73f57b685c7f637e948faa`
  (`fix(botapp): project active device runs and ignore stale blockers`).
- Status: **diagnosed / patched / tested / deployed**.
- Device Busy projection is derived from active request/run state so BotApp can
  show current device occupation without trusting stale UI state.
- Stale scheduler blockers for Mythyl are ignored once resolved /
  non-blocking; active blockers remain visible when
  `blocking_campaign=true`.
- The projection keeps current operator blockers visible and does not hide real
  Instagram challenge, checkpoint or identity mismatch restrictions.
- Production deployment:
  `dpl_4yJbW11sJ4MwoDoz164xYrHvLmMd`, READY on
  `www.boostmybusinesses.com`.

### Dispatcher / prod env

- `INSTAGRAM_RUN_CONTROL_DISPATCHER_WORKER_ID` prod aligné sur `run-dispatcher:mac-admin-01` (corrige `dispatcher_unconfigured` côté tick/cron).

### CP4.1 late preflight expiry

- **T-10:** `expires_at = session_start`
- **Late:** `expires_at = business_action_deadline`
- RPC `get_valid_scheduled_session_preflight` accepte `preflight_ready` jusqu’à la business deadline pour les rows late.

### CP4.1 late retry idempotency

- Clé déterministe `:retry:{preflightId}:{supersededRequestId}` sur la base late idempotency key.
- Cap anti-boucle: `MAX_LATE_PREFLIGHT_RETRY_GENERATIONS = 3` par fenêtre logique.

### Retry scoping

- **Non retryable (identity/challenge):** `login_challenge`, `checkpoint`, mismatch identity, etc.
- **Retryable (technical):** `preflight_expired`, `preflight_invalidated`, `preflight_lease_unavailable`, `device_serial_missing`.

### Dashboard action mapping

- `preflight_blocked` → action dashboard **pending** (opérateur)
- Terminal ready/expired → **resolved** via transition RPC / `resolvePreflightDashboardActionStatus`
- `reason_code` réel propagé dans metadata_safe + read-model

### Stale device lock self-heal

- `reconcileStaleDeviceLockBeforePreflight` avant enqueue CP4
- Release RPC canonique ; migration `20260710160100_drop_ambiguous_release_device_lock_overloads.sql` (overload ambiguë supprimée)
- Final cleanup status: **patched / tested**. The cleanup was scoped to the
  expired lock path only; no DB/settings/caps/package mutation is implied by
  this documentation update.

### BotApp observability read-model (deploy prod)

- `lib/instagram-dashboard/daily-scheduler-pipeline.ts` — projection tick → preflight → account_session (read-only)
- `scheduler-status.ts` expose `daily_scheduler_pipeline` + `daily_runtime_gate`
- `scheduler-reasons.ts` — codes keyguard + preflight enrichis

---

## 3. Corrections worker (instagram-worker-python)

### Preflight run type

- Support `scheduled_session_preflight` dans consumer + assignment resolver
- Claim dispatcher/worker pour preflight requests

### Hydration device / package

- ADB serial hydration pour `scheduled_session_preflight` dans `assignment_dispatch_resolver`
- `config.INSTAGRAM_PACKAGE = package_name` (corrige package mismatch clone)

### Preflight Hygiene Lite

- `force-stop` uniquement sur le package attendu
- Home → relaunch expected package
- Pas de « Close All »

### Guard Recovery Niveau A (preflight only)

- Classification login/challenge/checkpoint/popup/loading
- Screenshot/XML artifacts locaux + metadata_safe (pas de secrets)
- Identity guard avant décision terminal

### Keyguard handling (release active)

- `ensure_preflight_device_unlocked()` — wake + swipe-up **swipe-only**
- Reason codes: `device_locked`, `device_locked_requires_operator`
- Metadata: `screen_type=device_keyguard`, `detection_reason=android_keyguard_detected`, `unlock_attempted`, `unlock_result`
- **Aucun** bypass PIN/password/pattern

---

## 4. Corrections BotApp — Daily Scheduler Pipeline Observability

**Repo:** `BotApp-clean`
**Backup installé:** `/Users/admin/phonefarm-botapp-releases/daily-scheduler-observability-20260710T145509Z.app` → `/Applications/BotApp.app`

- Séparation UI **Daily Scheduler Pipeline** / **Auto Restart Engine**
- Détails preflight visibles (phase T-10/late, reason_code, keyguard metadata)
- Détails account_session visibles dans le pipeline
- `resume_plan_missing` documenté comme bruit Auto Restart
- Badges Profiles corrigés (`profile-growth-badge.ts`):
  - `connected` ≠ growth ready
  - `scheduler_launch_blocked` ≠ waiting slot
  - `device_locked` visible
  - preflight blocked visible
- Copy diagnostics enrichi (`App.tsx` — daily_scheduler + auto_restart sections)

---

## 5. Observations production — progression diagnostique

La chaîne Daily Scheduler a progressé par couches de blocage successives :

1. Blocages très haut niveau (scheduler off / gates / runtime)
2. `dispatcher_unconfigured` (worker id prod)
3. Missing preflight claim (worker run type)
4. `device_serial_missing` (resolver hydration)
5. Idempotency retry collisions (late CP4.1)
6. Package mismatch clone (`INSTAGRAM_PACKAGE`)
7. Stale device lock (lease CP3)
8. Keyguard / `device_locked` (Samsung swipe-to-open)
9. Stale dashboard blockers resolved but still projected by old BotApp state
10. Active device request/run not reflected as Busy until backend projection fix
11. Historical `operator_review_required` action correctly classified as
    operator/manual UI restriction, not a natural scheduler blocker

**Aujourd’hui:** la chaîne tick → preflight → session est **visible** dans BotApp + tables Supabase ; diagnostics beaucoup plus actionnables qu’en début de bloc CP4.

### Tracker scheduler verdict — 2026-07-12

- Active dashboard action observed:
  `operator_review_required`, `blocking_campaign=true`, `critical`, tied to
  `scheduled_retry_not_claimed_before_deadline`.
- Open incident preserved:
  `scheduled_early_failure_retrying` /
  `scheduled_retry_not_claimed_before_deadline`.
- No real Instagram challenge, checkpoint or identity mismatch was found in the
  traced blocker path.
- Scheduler path: `schedule-session-cron` calls
  `evaluateRunStartEligibility(accountId, "account_session", { trigger:
  "scheduler" })`. The hard-block classes are credentials, checkpoint and
  identity mismatch actions; `operator_review_required` is not one of them.
- Verdict: **`TRACKER_NATURAL_WINDOW_ELIGIBLE`**.
- DB before/after: no write required for this verdict; the critical incident
  and audit remain open until runtime Welcome/session validation.
- Start/Assign disabled in BotApp are operator/manual restrictions from the
  UI projection, not proof that the natural scheduler window is blocked.

---

## 6. Tables / sources de vérité

| Source | Usage |
|--------|--------|
| `scheduled_session_preflights` | État CP4 canonique par fenêtre |
| `account_run_requests` | Queue preflight + account_session |
| `account_dashboard_actions` | Actions opérateur (preflight_blocked pending) |
| `auto_restart_decisions` | **Auto Restart only** — ne pas confondre avec Daily Scheduler attempts |
| `auto_restart_device_locks` | Locks restart (distinct preflight lease) |
| `device_ui_lease_events` | CP3 lease preflight / handoff |
| `account_session_resume_plans` | Plans Auto Restart (`resume_plan_missing` noise) |
| BotApp **Scheduler** view | Pipeline read-model + runtime gate |
| Slack `phones_run_incidents` | Incidents phone farm |

```text
Auto Restart Recent decisions ≠ Daily Scheduler attempts.
Runs enqueued (24h) in old view was Auto Restart only.
```

---

## 7. Ce qui reste ouvert

### Validation naturelle finale (pas encore close en prod)

- [x] `preflight_ready` projeté/visible pour les comptes planifiés
- [ ] `account_session` créée naturellement au tick suivant dans la fenêtre
      Welcome/session attendue
- [ ] Dispatcher claim `account_session`
- [ ] Phone quitte idle pour une session naturelle validée
- [ ] Run terminalise proprement
- [ ] Dashboard action historique résolue uniquement après validation runtime
- [ ] Positive path `get_valid_scheduled_session_preflight → account_session` validé end-to-end

### Backlog technique explicite

- T-10 observability **P1**
- T-10 robustness **P2**
- Recovery Guard **Niveau B/C** non faits (dismiss popups, Not Now/Skip, vision fallback)
- Auto Restart noise/dedup `resume_plan_missing` — amélioration future
- Worker keyguard + autres patches locaux non commités dans ce checkpoint (voir git status worker)

---

## 8. Critères de validation finale restants

```text
[ ] fenêtre active
[ ] preflight T-10 ou late créé
[ ] dispatcher claim preflight
[ ] serial + package OK
[ ] identity guard OK
[ ] preflight_ready
[ ] tick suivant crée account_session
[ ] dispatcher claim account_session
[ ] worker démarre session
[ ] BotApp phone non-idle
[ ] run terminalise proprement
[ ] dashboard action résolue
[ ] no blind start respecté
```

---

## 9. Snapshot technique (IDs réels — vérifiés 2026-07-10)

| Composant | ID / chemin |
|-----------|-------------|
| Backend Vercel prod | `dpl_2rXNt8A1eebFRdV5PSgdMudkrVF2` (Ready, 2026-07-10 ~16:55 UTC+2) |
| Backend Vercel prod final | `dpl_4yJbW11sJ4MwoDoz164xYrHvLmMd` (Ready on `www.boostmybusinesses.com`, 2026-07-12/13) |
| Backend final commit | `61d6ccfc334ba084ff73f57b685c7f637e948faa` — active device Busy projection + stale blocker filtering |
| Backend git (pré-commit local) | `a97c876` — late CP4 expiry + dashboard reconcile |
| Worker Return CT commit | `26cd04cd816c8b358397e5e9d4224360fb5ea54f` |
| BotApp final commit | `dcbb85e9a1c9cad9f1a8a49eae9cf1f7e502206d` |
| BotApp official app | `/Applications/BotApp.app` |
| BotApp previous backup | `/Users/admin/phonefarm-botapp-backups/BotApp.app.20260713T000339SAST` |
| Worker release active | `/Users/admin/phonefarm-worker-releases/b6fedca-preflight-keyguard` |
| Worker git HEAD (repo) | `b6fedca` — late CP4 + dashboard reconcile |
| Dispatcher worker id | `run-dispatcher:mac-admin-01` |
| BotApp package backup | `daily-scheduler-observability-20260710T145509Z.app` |
| BotApp git (pré-commit local) | `95dd4f1` + patch observability non commité |

### Migrations Supabase pertinentes (CP4 / scheduler)

- `20260707180000_device_ui_lease_cp3.sql`
- `20260707220000_cp4_scheduled_session_preflights.sql`
- `20260709120000_cp4_late_preflight_expiry_fix.sql`
- `20260710120000_auto_restart_settings.sql`
- `20260710120100_auto_restart_v1_execution_foundation.sql`
- `20260710120200_auto_restart_device_lock_lifecycle.sql`
- `20260710160000_cp0_scheduler_toggle_gates_automatic_run_requests.sql`
- `20260710160100_drop_ambiguous_release_device_lock_overloads.sql` (local, à committer backend)

### Dernier checkpoint / doc de référence antérieur

- `docs/dev-session-latest.md` — mémoire volatile (derniers jalons 2026-06-xx)
- Backend `6971ed9` — `docs(admin): record production CP6 and Scheduler activation`
- Pas de dossier `docs/checkpoints/` avant ce fichier

---

## 10. Repos touchés par ce bloc

| Repo | Rôle |
|------|------|
| `boost-ai-frontend-clean` | CP4 cron/RPC, read-model pipeline, migrations |
| `instagram-worker-python` | Preflight runner, identity/keyguard, dispatcher consumer |
| `BotApp-clean` | Scheduler UI observability, badges Profiles, diagnostics |

**Hors scope checkpoint:** Android direct, schedules/caps/packages/clones/assignments/credentials/DM non modifiés pour ce commit doc.

---

*Interim checkpoint — ne pas interpréter comme GO production end-to-end Daily Scheduler.*
