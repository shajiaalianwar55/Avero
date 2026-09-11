# Customer API

All routes except `/health`, `/`, static assets, and `/api/config` require `Authorization: Bearer <Supabase access token>`. Identity and ownership fields come from that verified token; request bodies cannot choose a user ID. JSON errors use `{ "error": "..." }`.

## Profiles and homes

- `POST /api/profile` — `{ name }`
- `POST /api/homes` — `{ label, city, service_area, address? }`
- `GET /api/homes/:homeId`
- `GET /api/homes/:homeId/diagnoses`

## Diagnosis and guidance

- `POST /api/diagnosis/sessions` — `{ home_id, text, source?: "text" | "voice", asset_id?: string | null }`
- `GET /api/diagnosis/:id`
- `POST /api/diagnosis/:id/messages` — `{ text, source?: "text" | "voice" }`
- `POST /api/diagnosis/:id/attachments` — `{ mime_type, base64, caption? }`; JPEG, PNG, or WebP up to 4 MB
- `POST /api/diagnosis/:id/vision` — `{ attachment_id, question? }`
- `POST /api/diagnosis/:id/safety-check`
- `POST /api/diagnosis/:id/next`
- `POST /api/diagnosis/:id/classify`
- `GET /api/diagnosis/:id/summary`
- `GET /api/diagnosis/:id/evidence`
- `POST /api/diy/start` — confirmed low-risk sessions only
- `POST /api/diy/:guideId/step-result` — `{ step_index, result, note? }`

`result` is `done`, `different`, `failure`, or `stop`. Any new detail, changed condition, stale step, safety concern, or non-DIY classification blocks further steps.

## Handoff, history, and appliances

- `POST /api/service-requests` — `{ diagnosis_session_id, preferred_windows? }`; idempotent per diagnosis
- `GET /api/homes/:homeId/history`
- `GET /api/repair-records/:id`
- `GET /api/homes/:homeId/context?query=...`
- `POST /api/homes/:homeId/assets` — `{ name, type, make?, model?, serial?, photo_attachment_id? }`
- `GET /api/homes/:homeId/assets`
- `GET /api/assets/:id`

The service-request response is validated against `ServiceRequestContractSchema`, the exact handoff consumed by the marketplace. Repair history is read from `RepairRecordContract` rows produced by the marketplace completion flow; the customer app does not duplicate that owner's write path.

## Safety behavior

Hard rules for gas, burning electrical outlets, exposed wire, water near electricity, smoke/fire, and structural instability run before model guidance and remain sticky for the session. Model outage, invalid output, unassessed images, or unresolved safety uncertainty causes a stop/technician fallback. Avero never claims to contact emergency services on the user's behalf.
