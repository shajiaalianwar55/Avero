# Avero

Avero is a contract-first AI home-maintenance platform. The customer app includes authenticated home profiles, safety-first diagnosis, image assessment, a guarded DIY flow, technician handoff, repair history, warranty recall, and appliance profiles. The provider marketplace remains a separately owned application boundary.

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- Supabase CLI only when running the local database

## Start locally

```bash
npm install
Copy-Item .env.example .env
npm run check
```

Start Supabase, apply the migrations, then run the apps in separate terminals:

```bash
npm run dev:customer
npm run dev:provider
```

The default health endpoints are `http://localhost:3000/health` and `http://localhost:3001/health`.

The browser receives only `SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) stays on the server and must never use a `NEXT_PUBLIC_` prefix. Add `OPENAI_API_KEY` to enable model-assisted assessments; if the provider fails or is omitted, Avero returns a conservative technician/stop fallback instead of a fabricated diagnosis.

## Verification

With local Supabase running and migrations applied:

```bash
npm run check
npm run test:integration
npm run test:browser
```

`test:integration` uses temporary local-only users and records, tests ownership boundaries and RLS, then removes exactly those fixtures. `test:browser` adds desktop and mobile checks using an installed Edge browser. Neither command resets the database. Unit tests inject model responses and do not spend API credits.

## Database seed

`supabase/migrations` defines the Sprint 0 tables and `supabase/seed.sql` contains schema-valid demo records. Before resetting a local Supabase project, validate the source fixtures:

```bash
npm run seed:check
supabase db reset
```

## Workspace map

- `apps/customer`: homeowner application boundary
- `apps/provider`: provider application boundary
- `services`: feature-service boundaries documented for parallel development
- `packages/contracts`: shared Zod schemas, enums, and inferred TypeScript types
- `packages/ai-observability`: safe AI trace construction and development sinks
- `packages/ui`: shared design tokens
- `fixtures`: contract and evaluation inputs
- `supabase`: migrations and deterministic seed data
- `docs`: API, AI, and demo documentation

The root Markdown and Word build plans are the implementation contract. Cross-team payloads must pass the schemas in `@avero/contracts`; internal database rows are not integration contracts.

AI features must emit `AITraceEvent` records through `@avero/ai-observability` and retain structured evidence only. See `docs/AI_DISCLOSURE.md` and `docs/AI_EVALUATION.md` before adding or changing a model-assisted feature.
