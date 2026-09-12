# Marketplace

Boundary for provider discovery, dispatch, quote normalization, and offer ranking.

## B-01 Provider discovery

Implemented in the provider app:

- `POST /api/marketplace/discover`
- Auth: `Authorization: Bearer <Supabase access token>`
- Preferred body: `{ "service_request_id": "<id>" }` — loads and validates the stored `ServiceRequestContract`
- Alternate body: a full `ServiceRequestContract` owned by the authenticated user
- Response: `DiscoverResult` with deterministic `provider_candidates` from `public.providers`
- Does not invent contact channels, availability, or providers

## B-02 Request distribution

- `POST /api/service-requests/:id/dispatch`
- Auth: same Bearer ownership as B-01 (caller must own the service request)
- Body: `{ "provider_ids": ["pro_007", ...] }` — typically B-01 candidate ids
- Persists `provider_dispatches` with stable ids `disp_<request>_<provider>`
- Idempotent per `(service_request_id, provider_id)`; does not rewind `responded` / `expired`
- Channel adapter: hackathon default `portal` marks status `delivered` immediately so jobs are ready for B-03 `GET /api/provider/jobs`
- Future WhatsApp/SMS adapters should create `sent` then advance to `delivered` without changing this HTTP contract
- Helper `Dispatch.portalJobs(providerId)` lists open portal jobs for the upcoming provider portal

## B-03 Provider portal and quote submission

- UI: `http://127.0.0.1:3001/` (same Avero visual language as the customer app)
- `GET /api/config` — Supabase URL + publishable key for Auth
- `GET /api/providers` — seeded provider identities for the portal switcher
- `GET /api/provider/jobs?provider_id=` — open `sent`/`delivered` dispatches for that provider
- `POST /api/provider/jobs/:dispatchId/respond` — accept/decline with unstructured message and optional structured quote fields
- Writes `provider_responses` and, on accept, an `offers` draft (`extraction_confidence: 0`) for B-04 normalization
- Marks the dispatch `responded`; retries are idempotent
- Hackathon auth model: any signed-in user may select a provider identity to simulate independent technicians
