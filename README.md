# Avero

Avero is a contract-first AI home-maintenance platform. This repository starts with the shared integration contracts and deterministic demo data required by the build plan.

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

Run the homeowner and provider skeletons in separate terminals:

```bash
npm run dev:customer
npm run dev:provider
```

The default health endpoints are `http://localhost:3000/health` and `http://localhost:3001/health`.

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
- `packages/ui`: shared design tokens
- `fixtures`: contract and evaluation inputs
- `supabase`: migrations and deterministic seed data
- `docs`: API, AI, and demo documentation

The root Markdown and Word build plans are the implementation contract. Cross-team payloads must pass the schemas in `@avero/contracts`; internal database rows are not integration contracts.
