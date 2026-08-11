drop trigger if exists enforce_unfollow_search_unresolved_quarantine_v1
  on public.ig_unfollow_candidate_availability;

drop function if exists public.enforce_unfollow_search_unresolved_quarantine_v1();

