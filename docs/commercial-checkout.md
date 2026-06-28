# Commercial checkout simulé — Instagram Growth

## Catalogue serveur

Source unique : `lib/commercial/catalog.ts` + `lib/commercial/pricing.ts`.

- Packs : Growth 147 €, Pro 197 €, Premium 247 € (mensuel de référence)
- Outreach : Standard 89 €, IA 149 € (mutuellement exclusifs)
- Remises durée : 0 % / 10 % / 20 % / 25 % (1 / 3 / 6 / 12 mois)
- Remises Agence : 0 % (1–5), 14 % (6–10), 22 % (11–25), 32 % (26–40), 40 % (41–50), 45 % (51+)
- Règle : `max(remise durée, remise agence)` — jamais de cumul

Calcul centimes :

```text
monthly_discounted_price_cents = round(base * (1 - discount))
billing_period_total_cents = monthly_discounted_price_cents * billing_interval_months
```

## Parcours

### Premier compte

`/instagram-growth` → `/instagram-growth/checkout` → simulation → workspace + entitlement réservé → `/instagram-client` → Add Account consomme l’entitlement.

### Compte supplémentaire

Dashboard → Add Account → `/instagram-client/choose-plan` si pas d’entitlement réservé → checkout simulé → formulaire Add Account.

## Sécurité simulation

Variables :

- `SIMULATED_CHECKOUT_ENABLED=true`
- `SIMULATED_CHECKOUT_EMAIL_ALLOWLIST=email@domain.com`

### Premier checkout (`first_purchase`) — fail-closed test-only

En plus des variables ci-dessus, la simulation initiale exige côté **serveur** :

- `SUPABASE_URL` pointant vers la ref isolée `nxntngkhkoynljcagmkq` (jamais `NEXT_PUBLIC_*` pour la décision)
- `SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM=isolated-test-only`
- e-mail strictement `*@example.invalid`
- e-mail présent dans l'allowlist

Sinon : `403` (`simulated_checkout_forbidden` / `simulation_unavailable`), zéro provisioning.

Le changement de formule (Plan Change) conserve ses guards existants.

## Migration

Appliquer `supabase/migrations/20260615143000_commercial_checkout_entitlements.sql` avant activation réelle.

Tables :

- `commercial_checkout_sessions`
- `client_account_entitlements`
- `commercial_checkout_audit_events`

## Service métier partagé (Stripe futur)

`activateClientAccountEntitlementFromCheckout()` dans `lib/commercial/activate-client-account-entitlement-from-checkout.ts`.

Stripe remplacera uniquement la gate `mode: simulated` par `payment_succeeded` vérifié.

## Mode Agence

- **Affiché** : ≥ 2 comptes Instagram liés actifs/en onboarding (`agencyDisplayCount`)
- **Comptes facturables** : comptes liés + entitlements réservés (+1 uniquement pour un quote add-account **si** la réservation ne représente pas déjà l'achat en cours)
- **Entre 2 et 5 comptes liés** : Mode Agence actif, remise volume 0 % — message client :
  `Mode Agence actif — remise volume disponible à partir de 6 comptes.`
- **À partir de 6 comptes facturables** : tiers volume catalog (14 % / 22 % / …)
- **Snapshot immuable** : `pricing_snapshot` JSONB sur checkout sessions, entitlements et plan-change quotes (`CommercialPricingSnapshot`, version `2026-06-25.1`)
- **Règle remise** : `max(remise durée, remise volume)` — jamais de cumul ; égalité → durée prioritaire
- **Prix accepté** : figé par snapshot ; aucun recalcul rétroactif si le nombre de comptes change

Compteurs canoniques : `lib/commercial/commercial-account-counts.ts`  
Calcul central : `lib/commercial/pricing-snapshot.ts` + `lib/commercial/pricing.ts`

Dérivation affichage : `lib/commercial/agency.ts` — pas de vérité autonome dans `clients.metadata.agency_mode`.

### Risque checkout parallèle (documenté)

Un seul entitlement `reserved` est autorisé par client (index unique). Les quotes non activées se recalculent à la demande ; seul le checkout activé fige le snapshot.

Formule anti double-compte :

```text
billable = linked + reserved + projectedPurchaseSlots
projectedPurchaseSlots = 0 si reserved représente déjà l'achat quoté, sinon 1 (first/new account)
```

## Post-add-account (inchangé ce patch)

Ajout CT → Check Readiness → Connect → compte prêt. Package/outreach appliqués via `account_commercial_packages` + addons depuis l’entitlement consommé.
