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
- Does not implement final bill / payout (B-08), disputes (B-09), or repair records (C-01)

See also: `services/marketplace/README.md` (B-06 booking creates `pending_payment` jobs that this flow confirms).
