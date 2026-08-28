begin;

-- Append copy versions. V1 routing keys and every existing item stay unchanged.
insert into public.commercial_outreach_templates
  (template_key, channel, angle, version, intent, max_subject_chars, max_body_chars)
values
  ('IG_BEAUTY_ANGLE_A_V3', 'instagram', 'A', 'V3', 'Verified service observation; relevant Instagram audiences around similar businesses; targeted interactions bring people to the profile for visibility and qualified growth; light audience CTA. No signature.', 0, 650),
  ('IG_BEAUTY_ANGLE_B_V3', 'instagram', 'B', 'V3', 'Verified service observation; relevant Instagram audiences around similar businesses; targeted interactions bring people to the profile to reach potential customers; light audience CTA. No signature.', 0, 650),
  ('EMAIL_BEAUTY_ANGLE_A_V3', 'email', 'A', 'V3', 'Rich verified observation and opportunity; relevant Instagram audiences around similar businesses; targeted interactions bring people to the profile for visibility and qualified growth; light audience CTA. No signature.', 120, 1200),
  ('EMAIL_BEAUTY_ANGLE_B_V3', 'email', 'B', 'V3', 'Rich verified observation and opportunity; relevant Instagram audiences around similar businesses; targeted interactions bring people to the profile to reach potential customers; light audience CTA. No signature.', 120, 1200);

create function public.commercial_outreach_stamp_copy_version_v3()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare copy_key text;
begin
  -- Metadata only on new empty drafts, including replacements made by the
  -- existing owner-authorized regenerate RPC. Never UPDATE historical rows.
  if new.state = 'draft' and new.body is null and new.subject is null
     and new.approved_at is null and new.approved_by is null
     and new.generation_attempt_count = 0 then
    copy_key := case new.channel when 'instagram' then 'IG' when 'email' then 'EMAIL' end
      || '_BEAUTY_ANGLE_' || new.angle || '_V3';
    if not exists (select 1 from public.commercial_outreach_templates t
      where t.template_key = copy_key and t.channel = new.channel and t.angle = new.angle and t.active) then
      raise exception 'commercial_outreach_copy_version_unavailable' using errcode = '22023';
    end if;
    new.template_version := copy_key;
  end if;
  return new;
end;
$$;

revoke all on function public.commercial_outreach_stamp_copy_version_v3() from public, anon, authenticated;
grant execute on function public.commercial_outreach_stamp_copy_version_v3() to service_role;
create trigger commercial_outreach_stamp_copy_version_v3
  before insert on public.commercial_outreach_items
  for each row execute function public.commercial_outreach_stamp_copy_version_v3();

comment on function public.commercial_outreach_stamp_copy_version_v3() is
  'Insert-only copy metadata. template_key remains the V1 routing family; template_version references the actual V3 catalogue entry. No state transitions or historical rewrites.';

commit;
