# Dashboard Multi-Attempt Attribution V1 — pre-Approval 2

- Base production exacte : `0d335d1f6bfe86c078cf8df8e334d8132e3fa86e`.
- Autorité : reçus/événements Unfollow canoniques natifs.
- Déduplication : `action_id`.
- Attribution : `run_id` immutable, puis ordinal résolu par lignée
  request/run. Une racine legacy devient S1 seulement si un attempt ultérieur
  autoritaire pointe vers ce run; sinon elle reste `unattributed`.
- Le fallback `ig_interacted_users.unfollowed_at` n'est retenu que sans reçu
  canonique natif et conserve son propre `run_id`.
- Replays : Rex `19/101/0/120`; Nab, j_automatise et growth `80/0/0/80`;
  fixture trois attempts, priorité native et unknown fail-closed PASS.
- Le moteur de quota et les compteurs du run actif sont inchangés.
- Aucun déploiement avant Approval 2.
