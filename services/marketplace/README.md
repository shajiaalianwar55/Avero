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
