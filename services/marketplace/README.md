# Marketplace

Boundary for provider discovery, dispatch, quote normalization, offer ranking, and bookings.

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

## B-04 AI quote normalization

- `POST /api/offers/:id/normalize`
- Auth: Bearer token; caller must own the linked service request (same ownership model as B-01/B-02)
- Loads the B-03 offer draft + preserved `raw_response` (and optional `provider_responses` id for traces)
- Passes the stored `ServiceRequestContract` as context only — does not reshape A-09
- Writes an updated `offers.payload` as `NormalizedOfferContract` with real `extraction_confidence`
- Never invents quote fields; unknowns stay `null`; returns `missing_fields` and `normalization_warnings` beside the offer
- Records `AITraceEvent` (`feature_id: B-04`, prompt `b04.v1`) into `ai_events`
- Does not implement ranking (B-05)

## B-05 Offer ranking and recommendation explanation

- `GET /api/service-requests/:id/ranked-offers`
- Auth: Bearer token; caller must own the service request (same model as B-01/B-02/B-04)
- Loads B-04-normalized offers only (`extraction_confidence > 0`); declines and unnormalized drafts are excluded
- Deterministic multi-factor scores: price, availability, rating, warranty, fit (documented weights; urgency reweights availability/warranty)
- Paid placement is never a scoring factor
- AI (`b05.v1`) explains the precomputed ranking only — it does not choose or override the winner
- Persists a stable snapshot `rank_<service_request_id>` in `offer_rankings`
- Empty set → `recommended_offer_id: null`, `execution_state: abstained`
- Does not implement booking (B-06) or customer comparison UI

## B-06 Booking lifecycle

- `POST /api/bookings` — body `{ offer_id, appointment_window, notes? }`; creates `pending_payment` booking
- `GET /api/bookings/:id` — owned booking by the authenticated user
- `POST /api/bookings/:id/cancel` — cancels unless `completed` / `disputed`; frees the request for a new selection
- Auth: Bearer token; caller must own the linked service request / booking
- Stable ids `bk_<service_request_id>_<offer_id>`; same offer retry is idempotent
- One non-cancelled booking per service request (409 if another offer is selected while active)
- Confirmed price basis prefers `visit_fee`, then `estimated_total_min`, else `unspecified`
- Marks the service request `selected` on create; restore `offers_received` on cancel
- Payment deposit/confirm: see `services/payments/README.md` (B-07)
- Does not implement final bill (B-08) or repair records (C-01)
