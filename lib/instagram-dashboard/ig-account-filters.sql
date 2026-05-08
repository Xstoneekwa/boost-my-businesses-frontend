create table if not exists public.ig_account_filters (
  account_id uuid primary key references public.ig_accounts(id) on delete cascade,
  disable_filters boolean not null default false,
  skip_followers boolean not null default true,
  skip_following boolean not null default true,
  skip_non_business_profiles boolean not null default false,
  skip_business_profiles boolean not null default false,
  follow_private_profiles boolean not null default false,
  follow_only_private_profiles boolean not null default false,
  dm_private_profiles boolean not null default false,
  min_followers int not null default 1,
  max_followers bigint not null default 1000000000000,
  min_following int not null default 1,
  max_following bigint not null default 1000000000000,
  min_posts int not null default 1,
  blacklisted_words text not null default '',
  mandatory_words text not null default '',
  whitelist_words text not null default '',
  blacklist_accounts text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ig_account_filters
  add column if not exists disable_filters boolean not null default false,
  add column if not exists whitelist_words text not null default '',
  add column if not exists blacklist_accounts text not null default '';

create index if not exists ig_account_filters_updated_at_idx
  on public.ig_account_filters(updated_at desc);
