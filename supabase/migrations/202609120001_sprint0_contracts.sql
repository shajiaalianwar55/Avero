create table if not exists public.users (
  id text primary key,
  name text not null
);

create table if not exists public.homes (
  id text primary key,
  user_id text not null references public.users(id),
  label text not null,
  city text not null,
  service_area text not null
);

create table if not exists public.providers (
  id text primary key,
  name text not null,
  categories text[] not null default '{}',
  service_area text not null,
  rating numeric(2,1) check (rating between 0 and 5),
  review_count integer not null default 0 check (review_count >= 0),
  verification_status text not null
);

create table if not exists public.service_requests (
  id text primary key,
  user_id text not null references public.users(id),
  home_id text not null references public.homes(id),
  diagnosis_session_id text not null,
  payload jsonb not null,
  status text not null check (status in ('draft','open','offers_received','selected','booked','in_progress','completed','cancelled','disputed')),
  created_at timestamptz not null default now()
);

create table if not exists public.offers (
  id text primary key,
  service_request_id text not null references public.service_requests(id),
  provider_id text not null references public.providers(id),
  payload jsonb not null,
  raw_response text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.repair_records (
  id text primary key,
  home_id text not null references public.homes(id),
  service_request_id text not null references public.service_requests(id),
  payload jsonb not null,
  completed_at timestamptz not null
);
