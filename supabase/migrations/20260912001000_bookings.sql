-- B-06: bookings from selected offers (one non-cancelled booking per service request).
create table public.bookings (
  id text primary key,
  service_request_id text not null references public.service_requests(id),
  offer_id text not null references public.offers(id),
  provider_id text not null references public.providers(id),
  user_id text not null references public.users(id),
  home_id text not null references public.homes(id),
  status text not null check (status in (
    'pending_payment',
    'confirmed',
    'provider_en_route',
    'in_progress',
    'awaiting_final_bill',
    'awaiting_customer_approval',
    'completed',
    'cancelled',
    'disputed'
  )),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevents accidental duplicate active bookings for the same request (cancelled frees the slot).
create unique index bookings_one_active_per_request
  on public.bookings (service_request_id)
  where status <> 'cancelled';

create index bookings_request_idx
  on public.bookings (service_request_id, created_at desc);

create index bookings_user_idx
  on public.bookings (user_id, created_at desc);

create index bookings_offer_idx
  on public.bookings (offer_id);

alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;
grant select, insert, update, delete on public.bookings to service_role;
