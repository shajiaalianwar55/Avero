-- B-10: review and warranty capture after completed bookings.
create table public.reviews (
  id text primary key,
  booking_id text not null references public.bookings(id),
  user_id text not null references public.users(id),
  provider_id text not null references public.providers(id),
  rating integer not null check (rating >= 1 and rating <= 5),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index reviews_user_idx
  on public.reviews (user_id, created_at desc);

create index reviews_provider_idx
  on public.reviews (provider_id, created_at desc);

alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;
grant select, insert, update, delete on public.reviews to service_role;

create table public.warranties (
  id text primary key,
  booking_id text not null references public.bookings(id),
  review_id text not null references public.reviews(id),
  home_id text not null references public.homes(id),
  user_id text not null references public.users(id),
  provider_id text not null references public.providers(id),
  warranty_start date not null,
  warranty_end date,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create index warranties_user_idx
  on public.warranties (user_id, created_at desc);

create index warranties_home_idx
  on public.warranties (home_id, warranty_end desc);

create index warranties_review_idx
  on public.warranties (review_id);

alter table public.warranties enable row level security;
revoke all on public.warranties from anon, authenticated;
grant select, insert, update, delete on public.warranties to service_role;
