create table if not exists public.ai_events (
  event_id uuid primary key,
  occurred_at timestamptz not null,
  feature_id text not null check (feature_id in ('A-03','A-04','A-05','A-07','A-10','B-04','B-05','C-03')),
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_record_id text not null,
  output_record_id text,
  latency_ms integer not null check (latency_ms >= 0),
  confidence numeric check (confidence between 0 and 1),
  validation_passed boolean not null,
  structured_output jsonb,
  structured_evidence jsonb not null default '{}'::jsonb,
  safety_rule_hits text[] not null default '{}',
  execution_state text not null check (execution_state in ('success','fallback','error','abstained')),
  error_code text,
  fallback_reason text,
  constraint ai_events_error_context check (execution_state <> 'error' or error_code is not null),
  constraint ai_events_fallback_context check (execution_state not in ('fallback','abstained') or fallback_reason is not null),
  constraint ai_events_success_valid check (execution_state <> 'success' or validation_passed)
);

comment on table public.ai_events is
  'Retains safe structured evidence and model metadata only; hidden chain-of-thought must never be stored.';

create index if not exists ai_events_feature_time_idx on public.ai_events (feature_id, occurred_at desc);
create index if not exists ai_events_input_record_idx on public.ai_events (input_record_id);

alter table public.ai_events enable row level security;

-- No client policy is created. Server-side service-role code writes traces; anon/authenticated clients cannot read them.
revoke all on table public.ai_events from anon, authenticated;
grant select, insert, update, delete on table public.ai_events to service_role;

-- Sprint 0 has no browser-to-database feature yet. Keep every public table private until feature migrations add
-- ownership-aware grants and RLS policies for a concrete access path.
alter table public.users enable row level security;
alter table public.homes enable row level security;
alter table public.providers enable row level security;
alter table public.service_requests enable row level security;
alter table public.offers enable row level security;
alter table public.repair_records enable row level security;

revoke all on table public.users, public.homes, public.providers, public.service_requests, public.offers, public.repair_records
  from anon, authenticated;
grant select, insert, update, delete
  on table public.users, public.homes, public.providers, public.service_requests, public.offers, public.repair_records
  to service_role;
