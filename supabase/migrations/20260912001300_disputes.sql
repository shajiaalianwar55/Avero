-- B-09: disputes for no-show / contested jobs (no completion or payout).
create table public.disputes (
  id text primary key,
  booking_id text not null references public.bookings(id),
  payment_id text not null references public.payments(id),
  user_id text not null references public.users(id),
  status text not null check (status in ('open', 'under_review', 'resolved')),
  category text not null check (category in ('no_show', 'quality', 'other')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index disputes_user_idx
  on public.disputes (user_id, created_at desc);

create index disputes_payment_idx
  on public.disputes (payment_id);

alter table public.disputes enable row level security;
revoke all on public.disputes from anon, authenticated;
grant select, insert, update, delete on public.disputes to service_role;
