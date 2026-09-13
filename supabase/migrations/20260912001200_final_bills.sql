-- B-08: technician final bills (settlement/payout remain on public.payments).
create table public.final_bills (
  id text primary key,
  booking_id text not null references public.bookings(id),
  payment_id text not null references public.payments(id),
  user_id text not null references public.users(id),
  provider_id text not null references public.providers(id),
  status text not null check (status in ('submitted', 'approved', 'completed')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index final_bills_user_idx
  on public.final_bills (user_id, created_at desc);

create index final_bills_payment_idx
  on public.final_bills (payment_id);

alter table public.final_bills enable row level security;
revoke all on public.final_bills from anon, authenticated;
grant select, insert, update, delete on public.final_bills to service_role;
