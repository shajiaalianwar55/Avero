create table public.home_assets (
 id text primary key, user_id text not null references public.users(id), home_id text not null references public.homes(id), payload jsonb not null, created_at timestamptz not null default now()
);
create index home_assets_owner_home_idx on public.home_assets(user_id,home_id);
alter table public.home_assets enable row level security;
revoke all on public.home_assets from anon,authenticated;
grant select,insert,update,delete on public.home_assets to service_role;
create index repair_records_home_completed_idx on public.repair_records(home_id,completed_at desc);
