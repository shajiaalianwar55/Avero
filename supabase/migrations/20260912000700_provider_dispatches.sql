-- B-02: provider request distribution. Portal channel makes jobs available for B-03 without an external messenger.
create table public.provider_dispatches (
  id text primary key,
  service_request_id text not null references public.service_requests(id),
  provider_id text not null references public.providers(id),
  user_id text not null references public.users(id),
  channel text not null default 'portal',
  status text not null check (status in ('sent', 'delivered', 'responded', 'expired')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_request_id, provider_id)
);

create index provider_dispatches_provider_status_idx
  on public.provider_dispatches (provider_id, status, created_at desc);

create index provider_dispatches_request_idx
  on public.provider_dispatches (service_request_id, created_at desc);

alter table public.provider_dispatches enable row level security;
revoke all on public.provider_dispatches from anon, authenticated;
grant select, insert, update, delete on public.provider_dispatches to service_role;
