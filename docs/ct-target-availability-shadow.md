# Universal Target Availability Shadow

`assessTargetAvailability` aggregates evidence per tenant/account/target and emits status, confidence, reasons, evidence counts, freshness, terminal proof, recheck and quarantine recommendations.

Identity rules are fail closed: same certified stable ID before/after plus an unconflicted new username permits a `matched_rename` recommendation; similarity without stable ID is unresolved; a different stable ID or reassigned old username requires operator review. No username is changed.

A verified badge alone remains available. Restricted Followers evidence needs coherent surface evidence across two healthy distinct runs for medium confidence, or strong terminal evidence for high confidence. The domain uses `accessible audience insufficient`; it does not encode 50 as a universal limit.

All outputs are deterministic, serializable and mutation-free. Shadow and policy flags default OFF.
