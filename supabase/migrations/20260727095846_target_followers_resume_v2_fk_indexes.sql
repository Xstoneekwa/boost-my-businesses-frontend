-- Cover FK lookup paths reported by the post-migration performance advisor.
create index if not exists ig_tfr_checkpoint_target_idx
  on public.ig_target_followers_resume_checkpoints(target_id);
create index if not exists ig_tfr_checkpoint_events_account_idx
  on public.ig_target_followers_resume_checkpoint_events(account_id);
create index if not exists ig_tfr_checkpoint_events_target_idx
  on public.ig_target_followers_resume_checkpoint_events(target_id);
