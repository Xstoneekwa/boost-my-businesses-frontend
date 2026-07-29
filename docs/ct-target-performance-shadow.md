# Universal Target Performance Shadow

Performance is independent from Availability and Utilization. It reports profiles evaluated, eligible profiles, follows, skips, likes, errors, eligible yield, follow yield and followback rate when reliable.

States are `healthy`, `watch`, `underperforming`, `insufficient` and `stale`. Minimum volume and freshness are explicit. Low FBR with insufficient volume remains insufficient. A declared Worker incident excludes the sample and returns `insufficient`; it cannot lower target performance or prove exhaustion.

Performance alone cannot archive or replace a target.
