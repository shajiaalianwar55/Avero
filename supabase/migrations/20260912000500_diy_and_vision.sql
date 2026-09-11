create table public.diy_sessions (
 id text primary key, user_id text not null references public.users(id), session_id text not null unique references public.diagnosis_sessions(id), payload jsonb not null
);
create table public.diy_step_events (
 id text primary key, user_id text not null references public.users(id), guide_id text not null references public.diy_sessions(id), payload jsonb not null, created_at timestamptz not null default now()
);
create table public.visual_assessments (
 id text primary key, user_id text not null references public.users(id), session_id text not null references public.diagnosis_sessions(id), attachment_id text not null references public.attachments(id), payload jsonb not null, created_at timestamptz not null default now()
);
alter table public.diy_sessions enable row level security;
alter table public.diy_step_events enable row level security;
alter table public.visual_assessments enable row level security;
revoke all on public.diy_sessions,public.diy_step_events,public.visual_assessments from anon,authenticated;
grant select,insert,update,delete on public.diy_sessions,public.diy_step_events,public.visual_assessments to service_role;
create index diy_step_events_guide_idx on public.diy_step_events(guide_id);
create index visual_assessments_session_idx on public.visual_assessments(session_id);
