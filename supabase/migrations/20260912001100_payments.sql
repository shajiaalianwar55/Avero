-- B-07: sandbox deposit payments and append-only payment events (not legal escrow).
create table public.payments (
  id text primary key,
  booking_id text not null references public.bookings(id),
  user_id text not null references public.users(id),
  status text not null check (status in (
    'pending',
    'authorized',
    'paid',
    'partially_paid',
    'protected',
    'refund_pending',
    'refunded',
    'disputed',
    'payout_released'
  )),
  amount integer not null check (amount >= 0),
  currency text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index payments_user_idx
  on public.payments (user_id, created_at desc);

create index payments_booking_idx
  on public.payments (booking_id);

create table public.payment_events (
  id text primary key,
  payment_id text not null references public.payments(id),
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index payment_events_payment_idx
  on public.payment_events (payment_id, created_at);

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
revoke all on public.payments from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
grant select, insert, update, delete on public.payments to service_role;
grant select, insert, update, delete on public.payment_events to service_role;
