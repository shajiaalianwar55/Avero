-- B-03: raw provider responses for dispatched jobs. Offers table already exists from sprint 0.
create table public.provider_responses (
  id text primary key,
  dispatch_id text not null unique references public.provider_dispatches(id),
  service_request_id text not null references public.service_requests(id),
  provider_id text not null references public.providers(id),
  decision text not null check (decision in ('accept', 'decline')),
  payload jsonb not null,
  raw_response text not null,
  created_at timestamptz not null default now()
);

create index provider_responses_request_idx
  on public.provider_responses (service_request_id, created_at desc);

create index provider_responses_provider_idx
  on public.provider_responses (provider_id, created_at desc);

alter table public.provider_responses enable row level security;
revoke all on public.provider_responses from anon, authenticated;
grant select, insert, update, delete on public.provider_responses to service_role;
