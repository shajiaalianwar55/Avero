# Payments

Boundary for sandbox payment protection and transaction state transitions.

## B-07 Payment protection and deposit

Implemented in the provider app (in-process sandbox — no Stripe / live card capture):

- `POST /api/bookings/:id/payment-intent` — creates an `authorized` deposit intent from the booking `price_basis` (optional `{ method, amount }` override)
- `POST /api/payments/:id/confirm` — sandbox confirm → `protected` with receipt reference
- Auth: Bearer token; caller must own the booking / payment (`user_id`)
- Stable payment ids `pay_<booking_id>`; intent retries are idempotent while the booking is `pending_payment`
- Writes `payments` + `payment_events` (`intent_created`, `confirmed`)
- On confirm: booking → `confirmed`, service request → `booked`
- Every payment payload includes `protection_label: "Payment protected by Avero"`, `sandbox: true`, and `sandbox_disclosure: "Sandbox payment — not legal escrow"`
- Does **not** call the flow legal escrow

See also: `services/marketplace/README.md` (B-06 booking creates `pending_payment` jobs that this flow confirms).

## B-08 Final bill, approval, and payout state

API-first sandbox completion on top of the same deposit `payments` row (no second payment row; no Stripe):

- `POST /api/bookings/:id/final-bill` — body `{ lines: [{ kind, description, amount }], currency?, notes? }`
- `POST /api/bookings/:id/approve-final-bill` — homeowner approves; remaining balance settled in sandbox
- `POST /api/bookings/:id/complete` — requires approved + paid; booking/SR → `completed`; payment → `payout_released`
- Auth: Bearer ownership of the booking
- Stable final bill ids `fb_<booking_id>`; submit/approve/complete are idempotent once recorded
- `remaining_balance = max(0, total_amount - protected deposit_amount)`
- Writes `final_bills`; updates `payments` + `payment_events` (`remaining_settled`, `payout_released`)
- On submit: booking → `awaiting_customer_approval`
- On complete: automatically creates one C-01 `repair_records` row (`rr_<booking_id>`) — see `services/history/README.md`
- Does not implement reviews (B-10)

## B-09 Disputes and cancellation protection

Sandbox dispute path for no-show / contested jobs (no Stripe refunds):

- `POST /api/bookings/:id/disputes` — body `{ category: "no_show" | "quality" | "other", note }`
- `GET /api/disputes/:id` — owned dispute
- Eligible when booking is `confirmed` (or in-progress / awaiting bill/approval) and deposit is `protected`
- Sets booking + payment + service request to `disputed`; appends `payment_events.dispute_opened`
- Does **not** complete the job, set payment to `paid` / `payout_released`, or create a C-01 repair record
- Stable ids `dsp_<booking_id>`; open is idempotent
- Returns `funds_action_recommendation` + `admin_needed` (deterministic; always admin-needed for MVP)
- Rejects completed/cancelled/settled bookings
- Does not implement B-10 reviews
