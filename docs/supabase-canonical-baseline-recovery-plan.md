# Plan de récupération de la baseline Supabase canonique — sans exécution

## Statut

Ce document est exclusivement préparatoire. Aucun accès Supabase, SQL, CLI, migration, rebuild ou environnement temporaire n'a été exécuté pendant la Phase 4 CT Premium. Le statut reste `DATABASE_MIGRATION_HISTORY_UNCERTIFIED`.

Les nombres 167 migrations de production et 49 versions locales proviennent du cadrage de coordination et devront être revalidés au démarrage d'un chantier DB autorisé.

## Stratégie A — reconstitution exhaustive

1. Collecter les 167 versions et contenus de migrations appliquées, avec preuves cryptographiques et ordre effectif.
2. Inventorier les 49 versions locales, doublons, versions absentes et migrations au contenu divergent.
3. Construire une table de correspondance `production ↔ dépôt ↔ contenu` sans réparer implicitement.
4. Classer chaque entrée : exacte, locale seulement, production seulement, doublon de version, doublon de contenu ou divergence.
5. Reconstituer un historique linéaire certifié dans un worktree DB isolé.
6. Tester un rebuild complet sur base temporaire neuve.
7. Comparer structure, fonctions, triggers, policies, grants, extensions et données de référence avec un snapshot de production en lecture seule.
8. Définir rollback et validation avant toute modification de l'historique officiel.

Avantage : traçabilité historique maximale. Risque : erreurs de reconstruction et replay de migrations anciennes supposant un état intermédiaire disparu. Coût et délai élevés.

## Stratégie B — baseline canonique à date de coupure

1. Choisir une date/version de coupure explicitement approuvée.
2. Capturer et certifier un snapshot structurel complet : schémas, types, tables, indexes, contraintes, vues, fonctions, triggers, RLS, policies, grants, extensions et paramètres nécessaires.
3. Enregistrer formellement que la production existante précède la baseline et ne doit pas rejouer son bootstrap.
4. Créer un bootstrap déterministe réservé aux nouveaux environnements.
5. Faire démarrer les migrations futures strictement après la coupure, avec contrôle CI des versions et contenus.
6. Tester bootstrap + migrations post-coupure sur une base temporaire neuve.
7. Définir une procédure production non-replay, une stratégie de rollback et des marqueurs explicites d'environnement.
8. Conserver l'ancien historique comme archive probatoire, sans le présenter comme rejouable.

Avantage : maintenabilité et reproductibilité futures plus fortes. Risque : perte de rejouabilité historique avant la coupure, compensée par l'archive et le snapshot certifié.

## Comparaison

| Critère | A — exhaustive | B — baseline à date |
|---|---|---|
| Risque immédiat | Élevé : ordre/contenu anciens incertains | Moyen : exige snapshot complet et non-replay strict |
| Coût | Très élevé | Élevé mais borné |
| Délai | Long et difficile à estimer | Plus prévisible |
| Traçabilité historique | Maximale si reconstruction réussie | Archive complète, replay antérieur non garanti |
| Maintenabilité future | Moyenne si dette historique conservée | Forte |
| Compatibilité production | Risque de replay accidentel | Forte avec marqueur de coupure |
| Nouveaux environnements | Rebuild complet si toutes les migrations passent | Bootstrap canonique plus simple |
| Rollback | Complexe sur longue chaîne | Borné à baseline + migrations futures |

## Recommandation

Recommander la stratégie B, précédée d'un audit ciblé de type A uniquement pour établir les preuves indispensables : inventaire des 167/49 versions, doublons et divergences critiques. Cette approche hybride ne tente pas de rendre artificiellement rejouable chaque migration historique ; elle protège la production existante, crée une source canonique à date et impose un historique propre pour la suite.

## Gates avant décision

- autorisation explicite d'accès DB en lecture seule ;
- propriétaires et fenêtre de changement identifiés ;
- gel des migrations concurrentes ;
- méthode de snapshot et comparaison approuvée ;
- environnement temporaire isolé ;
- sauvegarde et rollback vérifiés ;
- CI non-replay définie ;
- revue sécurité des fonctions privilégiées, RLS et grants ;
- GO/NO-GO distinct avant toute écriture de migration ou d'historique.
