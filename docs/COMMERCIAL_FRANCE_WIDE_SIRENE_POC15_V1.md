# France-wide Sirene structured discovery — execution contract

Authorization: COMMERCIAL FRANCE-WIDE SIRENE DISCOVERY FOUNDATION + POC 15 V1, 2026-09-26. This document is written before any real POC request.

## National query and budgets

GET `https://api.insee.fr/api-sirene/3.11/siret` with header `X-INSEE-Api-Key-Integration` from the server-only sensitive variable. Never export or print its value.

Exact `q`:
```
periode(etatAdministratifEtablissement:A AND (activitePrincipaleEtablissement:96.02A OR activitePrincipaleEtablissement:96.02B)) AND statutDiffusionEtablissement:O AND statutDiffusionUniteLegale:O AND codeCommuneEtablissement:*
```
Parameters: `date=<UTC execution date>`, `nombre=100`, `curseur=*` initially, then the returned cursor only if fewer than 15 eligible candidates. At most **2 Sirene requests**, separated by at least 2.2 seconds, no retries. At most 200 records examined in memory. The date and final-period checks exclude historical matches. No city predicate, no city portfolio, no national exhaustive scan. Foreign addresses are excluded by the adapter; overseas geographic codes are preserved.

Among equally eligible candidates, deterministic department/city diversity tie-break then exact external ID; stop at 15. This is a bounded engineering sample, **not a representative statistical sample**. No fit scores or regional quotas are introduced.

Per selected establishment: at most one targeted Google/SearchAPI lookup, no page 2; maximum two website requests including robots.txt. At most 15 profile-enrichment attempts and 15 AI scoring calls. Three concurrent candidate tasks, 240-second new-call deadline, no implicit retries. Durable reservations occur before every external stage. Unknown outcomes remain reserved, never replayed. Failed run requires a new explicit authorization, not an automatic restart.

## Source policy

`SIRENE_ACTIVE_FULL_DIFFUSION_V1`: current establishment A, legal unit A, establishment and legal-unit diffusion both O. P/N/missing/unknown fail closed before retention of identifying fields or external enrichment. Exclusions retain only identifier, status, reason, checked time and policy version. Eligible candidates retain minimal establishment fields, not raw historical API payloads. Source attribution: INSEE — Répertoire Sirene, Licence Ouverte 2.0, observed_at and exact SIRET.

Source eligibility here authorizes this bounded internal qualification step, **not automatic outreach**; further contact/channel compliance remains a separate gate.

## FR_BEAUTY_ACTIVITY_FILTER_V1

| Code | Nomenclature | Label | Included | Reason |
|---|---|---|---|---|
| 96.02A | NAFRev2 | Coiffure | yes | Hair/barber services explicitly classified by INSEE |
| 96.02B | NAFRev2 | Soins de beauté | yes | Beauty care, manicure/aesthetic pedicure, makeup and epilation explicitly classified by INSEE |
| All other codes | any | Not inferred | no | Not certified by this narrow V1 policy |
| Anticipatory NAF2025 fields | NAF2025 | Not used for current activity | no | Current classification remains NAFRev2 through 2026; no speculative mapping |

Policy fails closed from 2027-01-01 or for an unexpected current nomenclature. APE is evidence of a broad registered activity, not proof of every service in that category.

## Resolver and identity

Provider-neutral input/output. Official website first when supplied; authorized social link alone is not HIGH. Otherwise one exact business name + city + Instagram lookup; use at most one plausible site result. Search snippets alone never produce HIGH. Site must corroborate the business name, complete street address, postal code and city and directly link exactly one root Instagram account. Known shared platforms/directories are excluded from website-ownership evidence. SSRF: public IPv4-only DNS, connection pinned to inspected address, TLS verified, HTTPS/443 only, no redirects, bounded payload/time; any robots disallow conservatively stops page retrieval. No authenticated pages or crawling.

HIGH requires the localized site evidence above, then exact public-profile canonical username. MEDIUM/LOW never score. A handle shared by multiple cohort SIRETs is downgraded before enrichment; existing structured shared handles also force review. This intentionally favors false negatives over false automatic associations. Human false-HIGH rate stays NOT_YET_MEASURED.

Existing `create_structured_commercial_business_v1` handles exact provider identity and cross-provider holds; no handle/domain/name merge. Existing immutable identity mode and legacy uniqueness retained. No changes to scoring, AI prompt, channel, angle, SA queries or outreach. Future adapter consumes the same candidate/resolver/scoring contracts; provider and national activation policy are configuration, not a new CRM.

## Persistence / security

Reuse commercial_discovery_runs/items, commercial_businesses/identifiers, commercial_leads/events. One generic execution ledger adds one-shot authorization and call reservations. Browser anon/authenticated have no access to its table/functions. Backend requires authenticated superadmin AND active commercial_crm_access. Mutation is same-origin POST. Actor comes from the verified session, never request body.

Structured run uses discovery_status=completed, attempt_count=max_attempts=1; structured items have selected_for_processing=false. Therefore both legacy claim functions cannot claim the run/items, without changing SA worker logic. Scored leads remain qualified/enriched/not_qualified with no approval and no outreach. The existing transport path is never imported or invoked.

Owner view: `/instagram-dashboard/commercial/structured`. One-shot button disabled by persistent run existence. GET/reload performs no discovery/enrichment/AI calls. SIRET, activity, geography, match evidence, score, priority, channel and angle displayed.

## Sources checked before implementation

- [INSEE API service / diffusion policy](https://www.data.gouv.fr/dataservices/api-sirene-open-data)
- [INSEE API current-period documentation](https://www.sirene.fr/static-resources/htm/siret_unitaire_311.html)
- [INSEE API quotas and cursor pagination](https://www.insee.fr/fr/information/9019311)
- [INSEE diffusion changes](https://www.sirene.fr/static-resources/documentation/Sirene_4-Onglet-Statut_Diffusion.pdf)
- [INSEE coiffure 96.02A](https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/96.02a)
- [INSEE soins de beauté 96.02B](https://www.insee.fr/fr/metadonnees/nafr2/sousClasse/96.02B)
- [INSEE Sirene dataset / anticipatory NAF2025](https://www.data.gouv.fr/datasets/base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret/)

Public Sirene API is free within its public plan. SearchAPI effective plan cost is not known; AI token usage is retained when returned. No fabricated cost-per-lead. A result with no HIGH associations is a valid negative POC, not permission to tune or rerun.

## Preflight baseline

SA database hashes before this phase (to_jsonb ordered by id, 2026-09-26): businesses 81 `e99f832004489408273a145e6b7a5836`; leads 81 `626133db92e4527bf45083d920032d04`; runs 14 `aac60a2239edbdf71e652752cc692f22`; items 181 `73579db0e5a30f04e97f7d4e0e7b5acc`.

Prior same-day auth smoke: exactly one server-side GET nombre=1 returned HTTP 200 against API 3.11. This phase does not repeat that smoke. The national POC query is a separate authorized bounded run, only after tests/migration/build gates pass.
