-- B-05: persisted ranked-offer snapshots for a service request (deterministic scores + explanation).
create table public.offer_rankings (
  id text primary key,
  service_request_id text not null references public.service_requests(id),
  user_id text not null references public.users(id),
  recommended_offer_id text references public.offers(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (service_request_id)
);

create index offer_rankings_request_idx
  on public.offer_rankings (service_request_id, created_at desc);

alter table public.offer_rankings enable row level security;
revoke all on public.offer_rankings from anon, authenticated;
grant select, insert, update, delete on public.offer_rankings to service_role;
