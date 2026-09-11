create table public.diagnosis_sessions (
  id text primary key, user_id text not null references public.users(id),
  home_id text not null references public.homes(id), payload jsonb not null,
  created_at timestamptz not null default now()
);
create table public.diagnosis_messages (
  id text primary key, user_id text not null references public.users(id),
  session_id text not null references public.diagnosis_sessions(id), payload jsonb not null,
  created_at timestamptz not null default now()
);
create table public.attachments (
  id text primary key, user_id text not null references public.users(id),
  session_id text not null references public.diagnosis_sessions(id), payload jsonb not null,
  created_at timestamptz not null default now()
);
create table public.safety_events (
  id text primary key, user_id text not null references public.users(id),
  session_id text not null references public.diagnosis_sessions(id), payload jsonb not null,
  created_at timestamptz not null default now()
);
create index diagnosis_sessions_owner_home_idx on public.diagnosis_sessions(user_id, home_id);
create index diagnosis_messages_session_idx on public.diagnosis_messages(session_id, created_at);
create index attachments_session_idx on public.attachments(session_id);
create index safety_events_session_idx on public.safety_events(session_id);
alter table public.diagnosis_sessions enable row level security;
alter table public.diagnosis_messages enable row level security;
alter table public.attachments enable row level security;
alter table public.safety_events enable row level security;
revoke all on public.diagnosis_sessions, public.diagnosis_messages, public.attachments, public.safety_events from anon, authenticated;
grant select, insert, update, delete on public.diagnosis_sessions, public.diagnosis_messages, public.attachments, public.safety_events to service_role;
