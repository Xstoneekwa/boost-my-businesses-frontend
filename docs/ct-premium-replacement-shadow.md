# CT Premium Replacement Shadow — V2-1

The local simulator previews replacement-first using synthetic candidates only. It checks Premium entitlement and runtime blockers, filters blacklist/duplicate/ownership conflicts and score, builds a deterministic hypothetical candidate set and exposes source target, reason, confidence, need, blockers, candidate count, policy path, deferred archive and terminal preview.

It never calls a provider, creates a proposal or batch, starts J+5, activates a candidate, archives the source target, writes business tables, notifies or emails. Its output is JSON-serializable and explicitly marks all those effects false.
