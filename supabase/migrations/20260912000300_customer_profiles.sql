alter table public.users add column if not exists email text;
alter table public.homes add column if not exists address text;
create index if not exists homes_user_id_idx on public.homes(user_id);
