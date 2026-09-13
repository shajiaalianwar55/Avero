# History

Boundary for repair-record generation and history-aware retrieval.

## C-01 Home History record generation

Implemented in the provider app as an automatic hook on B-08 job completion:

- Trigger: successful `POST /api/bookings/:id/complete` (also ensured on idempotent re-complete)
- Writes one `repair_records` row with stable id `rr_<booking_id>`
- Payload validated as existing `RepairRecordContract` (no schema redesign)
- Maps booking + service request + final bill + offer `warranty_days` → `warranty_end`
- `asset_id` from owned diagnosis session payload when present; otherwise `null`
- `amount_paid` = final bill `total_amount`; `work_done` from bill notes or line descriptions
- Idempotent: repeated complete / ensure returns the same record
- Does not implement customer Home History UI (C-02), history-aware recall (C-03), reviews, or warranties tables (B-10)

Consumer: customer `GET /api/homes/:homeId/history` (Shajia) reads these rows.
