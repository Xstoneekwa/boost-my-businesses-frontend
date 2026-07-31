-- Operational rollback: remove only Loriele's durable pilot assignment. The
-- control-gated function remains dormant when no account row is armed.
delete from public.follow_60s_canary_controls
where account_id = 'dfe78a92-3a51-435e-8911-ed10c93a4d82'::uuid;
