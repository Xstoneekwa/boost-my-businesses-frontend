begin;

drop trigger if exists commercial_leads_z_outreach_sync_v1 on public.commercial_leads;
drop trigger if exists commercial_leads_a_outreach_template_v1 on public.commercial_leads;
drop trigger if exists commercial_outreach_events_append_only on public.commercial_outreach_events;
drop trigger if exists commercial_outreach_items_touch_updated_at on public.commercial_outreach_items;

drop function if exists public.mutate_commercial_outreach_item_v1(uuid, uuid, text, integer, text, jsonb);
drop function if exists public.complete_commercial_outreach_generation_v1(uuid, text, boolean, jsonb, text[]);
drop function if exists public.claim_commercial_outreach_items_v1(integer, text);
drop function if exists public.commercial_outreach_sync_lead_v1();
drop function if exists public.commercial_outreach_apply_template_v1();
drop function if exists public.commercial_outreach_prevent_event_mutation_v1();
drop function if exists public.commercial_outreach_touch_updated_at_v1();
drop function if exists public.commercial_outreach_payload_basic_valid_v1(text, text, text);
drop function if exists public.commercial_outreach_template_key_v1(text, text);

drop table if exists public.commercial_outreach_events;
drop table if exists public.commercial_outreach_items;
drop table if exists public.commercial_outreach_templates;
drop index if exists public.commercial_leads_id_campaign_v1_uidx;

commit;
