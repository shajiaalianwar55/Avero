# Avero - Comprehensive Build and Integration Plan

**Team:** You + Aaima  
**Purpose:** Hackathon MVP designed to score strongly as both a credible startup and a technically serious AI product across Next Founders and Hyperbloom  
**Document role:** Shared implementation contract for GitHub development, integration, testing, and dual-hackathon submission readiness

## 1. Product Definition

Avero is an AI-powered home maintenance platform. A homeowner can describe a household problem by voice, text, or image. Avero asks adaptive questions, continuously checks for safety risks, and routes the case to one of three outcomes: guided DIY, professional technician, or emergency action. If a technician is required, Avero creates a structured service request, collects and normalizes provider offers, helps the homeowner compare options, supports booking and protected payment, and records the completed repair in Home History for future context, warranty reuse, and repeat-issue support.

## 2. Product Principles

- **Safety before convenience:** Emergency and high-risk signals override normal diagnosis and DIY guidance.
- **Contract-first integration:** Every cross-team feature has a defined JSON input and output before either person builds against it.
- **Real workflow over flashy demo:** The hackathon MVP must complete the full journey from problem description to resolution or booking.
- **Explain decisions:** Avero should tell users why it chose DIY, technician, emergency, or a recommended provider.
- **Progressive realism:** Use real AI and real state transitions, but simulate infrastructure that would slow the hackathon, such as nationwide WhatsApp delivery or real payouts.
- **History creates retention:** Every completed repair becomes structured Home History that improves the next interaction.
- **AI must be material:** AI should drive adaptive questioning, classification, multimodal understanding, quote normalization, recommendation, and contextual recall. It must not be decorative.
- **Structured evidence, not hidden reasoning:** Show users the observed facts, safety flags, score breakdowns, uncertainty, and decision outcome. Never expose or depend on private chain-of-thought.
- **Evaluate the AI:** Every AI feature needs at least one success fixture, one difficult fixture, and one failure/abstention fixture so the team can demonstrate reliability instead of only showing a happy path.


## 3. Dual-Hackathon Success Criteria

Avero should be built once and presented differently depending on the competition. The product, repository, and core demo remain the same. The emphasis changes.

### Next Founders emphasis

- **Technical execution:** the complete workflow must function end to end, not just the voice agent.
- **Innovation and UX:** adaptive diagnosis, guided DIY, clear technician comparison, and a polished homeowner journey.
- **Business and finance:** transaction commission, payment protection, provider economics, repeat usage, and Home History as a retention loop.
- **Communication:** the problem and value proposition must be understandable within the first 20 to 30 seconds of the demo.

### Hyperbloom emphasis

- **Impact and relevance:** show why safer, clearer, and more accessible home maintenance matters to real households.
- **Innovation and creativity:** emphasize the agent that dynamically changes questions, changes classifications when new evidence appears, and hands work to the marketplace only when required.
- **Technical implementation:** show the AI orchestration, safety layer, structured contracts, database state, quote pipeline, and working end-to-end system.
- **AI/ML integration:** make AI central and visible in adaptive questioning, triage, vision, quote extraction, recommendation, and history-aware context.
- **Presentation and demo:** show live behavior and structured evidence, not a slideshow of planned features.

### Submission requirement checklist

- Public or submission-ready GitHub repository with a clear README and setup instructions.
- AI tool/model disclosure file that lists every model/provider and what it is used for.
- Demo-safe seed data and fixtures so the product can be shown reliably.
- Clear limitations and simulated infrastructure disclosure, especially for payments, WhatsApp/SMS, emergency calling, and nationwide provider discovery.
- No claim that private model reasoning is exposed. User-facing explanations must be generated from structured evidence fields.
- Re-check each Devpost rules page immediately before submission in case requirements change.

## 4. Team Ownership

### You - Maintenance Intelligence and Customer Experience

**Owns**
- Customer issue intake by voice, text, and image
- Adaptive diagnostic questioning
- Safety and emergency guardrails
- DIY vs technician vs emergency classification
- Interactive DIY guidance and step state
- Diagnosis summary and technician handoff ticket
- Customer-facing Home History UI and contextual recall
- Customer-side integration of Aaima's marketplace outputs

**Does not own**
- Provider discovery logic
- Provider response portal
- Offer normalization and ranking
- Booking/payment backend
- Final payout/dispute state machine

### Aaima - Marketplace, Transactions, and Provider Experience

**Owns**
- Technician/provider directory and discovery
- Provider request distribution and provider portal
- Provider quote collection
- AI normalization of messy provider responses
- Offer ranking and recommendation explanation
- Booking lifecycle
- Payment protection, deposit/final bill flow, and sandbox payment integration
- Job completion, warranty, review, and repair-record generation

**Does not own**
- Diagnostic interview logic
- DIY repair instructions
- Safety classification logic
- Customer voice agent orchestration

## 5. End-to-End Product Flow

```text
Problem -> voice/text/image intake -> adaptive diagnosis -> continuous safety check -> DIY / technician / emergency
DIY -> step-by-step repair -> resolved OR escalate -> service request
Technician -> provider discovery -> provider responses -> normalized offers -> ranked comparison -> booking -> protected payment -> service -> final bill -> completion -> review/warranty -> Home History
Emergency -> stop troubleshooting -> immediate safety actions -> appropriate emergency/professional direction
```

## 6. Feature Specifications

### S-01 - Repository, environments, and shared contracts [P0]

**Owner:** Both

**Purpose:** Create one source of truth for schemas, enums, fixtures, and environment names before feature work starts.

**Inputs:** Agreed product flow and data fields.

**Required output:** Shared TypeScript types/Zod schemas, .env.example, sample JSON fixtures, repository folders, seed script.

**Database writes:** None directly.

**API/Interface:** N/A. Shared package imported by both sides.

**Consumed by:** Every feature in the repository.

**Definition of done:** Both developers can run their app locally, import the same shared types, and validate the same sample service request and offer fixtures.

### S-02 - AI observability, evaluation, and disclosure [P0]

**Owner:** Both

**Purpose:** Make every AI-powered feature testable, explainable at the product level, and easy to disclose for Hyperbloom without exposing private chain-of-thought.

**Inputs:** Feature ID, model/provider name, prompt or workflow version, structured input reference, structured output, latency, confidence where available, safety-rule hits, and validation result.

**Required output:** AITraceEvent records plus `docs/AI_DISCLOSURE.md`, `docs/AI_EVALUATION.md`, and a small evaluation fixture set. AITraceEvent should contain feature_id, model, prompt_version, input_record_id, output_record_id, latency_ms, confidence, validation_passed, structured_evidence, and error/fallback state.

**Database writes:** `ai_events` or equivalent development log table. Do not store hidden chain-of-thought. Store only inputs that are safe to retain, structured outputs, evidence fields, model metadata, and errors.

**API/Interface:** Internal logging helper shared by both apps/services. Optional development-only `GET /api/debug/ai-events/:id`.

**Consumed by:** Debugging, AI evaluation, demo preparation, README/submission documentation, and post-hackathon monitoring.

**Definition of done:** Each AI feature has at least three fixtures: normal success, difficult/ambiguous case, and safe failure/abstention. The team can state exactly which model powers each feature and show that schema validation/fallback behavior exists.

### A-01 - User, Home, and basic profile setup [P0]

**Owner:** You

**Purpose:** Give every diagnosis, booking, payment, and repair record a stable user/home context.

**Inputs:** Name, email/auth identity, home label, approximate service area, optional address fields.

**Required output:** user_id, home_id, service_location object.

**Database writes:** users, homes.

**API/Interface:** POST /api/homes, GET /api/homes/:homeId

**Consumed by:** Diagnosis session, service request, provider search, Home History.

**Definition of done:** A logged-in user has at least one home and Avero can attach all later records to home_id.

### A-02 - Multimodal issue intake [P0]

**Owner:** You

**Purpose:** Let the homeowner start naturally using voice or text, with image attachment when useful.

**Inputs:** Voice transcript or typed message; optional image; home_id.

**Required output:** diagnosis_session_id plus normalized initial complaint.

**Database writes:** diagnosis_sessions, diagnosis_messages, attachments.

**API/Interface:** POST /api/diagnosis/sessions, POST /api/diagnosis/:id/messages, POST /api/diagnosis/:id/attachments

**Consumed by:** Adaptive diagnostic interview.

**Definition of done:** A user can say or type a problem and see a live diagnosis session created with the transcript stored.

### A-03 - Adaptive diagnostic interview [P0]

**Owner:** You

**Purpose:** Ask only the next most useful question instead of running a fixed questionnaire.

**Inputs:** Complaint, previous Q&A, attachments, safety state, category hypothesis.

**Required output:** next_question, current hypotheses, confidence, information_gaps, enough_information boolean.

**Database writes:** diagnosis_messages and diagnosis_state snapshot.

**API/Interface:** POST /api/diagnosis/:id/next

**Consumed by:** Safety engine and outcome classifier.

**Definition of done:** Different user answers create different follow-up paths, and the interview can stop when sufficient information exists.

### A-04 - Safety and emergency guardrail [P0]

**Owner:** You

**Purpose:** Continuously detect red flags and stop unsafe troubleshooting immediately.

**Inputs:** Every user message, image assessment, device/category context, explicit safety rules.

**Required output:** safety_level, safety_flags, safe_to_continue, immediate_actions, prohibited_actions, emergency_type.

**Database writes:** safety_events and diagnosis_state.

**API/Interface:** Internal service plus POST /api/diagnosis/:id/safety-check if separated.

**Consumed by:** Diagnostic interview, DIY mode, outcome classifier.

**Definition of done:** Test cases such as gas smell, burning socket, exposed wire, standing water near electricity, smoke/fire, and structural instability interrupt normal guidance.

### A-05 - Outcome classifier: DIY vs technician vs emergency [P0]

**Owner:** You

**Purpose:** Convert the diagnosis state into a clear next action with a reason.

**Inputs:** Diagnosis hypotheses, confidence, safety state, required skill, user capability constraints.

**Required output:** classification, reason, urgency, confidence, recommended_next_action.

**Database writes:** diagnosis_sessions final classification.

**API/Interface:** POST /api/diagnosis/:id/classify

**Consumed by:** DIY mode, emergency response, or technician handoff.

**Definition of done:** Each scenario reaches exactly one current classification, with the ability to change classification later if new information appears.

### A-06 - Interactive DIY guidance [P0]

**Owner:** You

**Purpose:** Guide a safe DIY fix one step at a time instead of dumping a long answer.

**Inputs:** Confirmed low-risk issue, user context, tools available, safety preconditions.

**Required output:** guide_id, tools, safety_preconditions, current_step, expected_result, stop_conditions, fallback_action.

**Database writes:** diy_sessions, diy_step_events.

**API/Interface:** POST /api/diy/start, POST /api/diy/:id/step-result

**Consumed by:** Customer UI and escalation logic.

**Definition of done:** User can mark a step done, say it looks different, report failure, or stop. Avero adapts and can escalate to technician.

### A-07 - Image-assisted DIY and diagnosis [P1, Hyperbloom priority]

**Owner:** You

**Purpose:** Use a photo when the homeowner cannot identify a component or when visual evidence improves diagnosis.

**Inputs:** Image plus question/context.

**Required output:** visual_findings, relevant_component, hazard_flags, confidence, user-facing explanation.

**Database writes:** attachments and visual_assessments.

**API/Interface:** POST /api/diagnosis/:id/vision

**Consumed by:** Diagnostic interview or DIY mode.

**Definition of done:** At least one tested case uses an image to identify a relevant component, extract a visible finding, or trigger a stop condition. For Hyperbloom, include this in the recorded demo if stable; do not force a visual conclusion when confidence is low.

### A-08 - Diagnosis summary [P0]

**Owner:** You

**Purpose:** Show the homeowner a concise, understandable summary before DIY or technician handoff.

**Inputs:** Final/current diagnosis state.

**Required output:** problem_summary, likely_issue, alternatives, urgency, confidence, recommended_action, safety_notes, observed_evidence, uncertainty_notes.

**Database writes:** diagnosis_summary JSON on diagnosis_sessions.

**API/Interface:** GET /api/diagnosis/:id/summary

**Consumed by:** Customer UI and service request generator.

**Definition of done:** Summary can be rendered without parsing raw conversation text.

### A-09 - Technician handoff service ticket [P0]

**Owner:** You

**Purpose:** Translate diagnostic conversation into one standardized object that Aaima's marketplace can consume without knowing your internal agent logic.

**Inputs:** Diagnosis summary, Q&A facts, location, attachments, preferred time, optional budget.

**Required output:** ServiceRequestContract JSON exactly matching shared schema.

**Database writes:** service_requests with status=draft or open.

**API/Interface:** POST /api/service-requests

**Consumed by:** Aaima: provider discovery and request distribution.

**Definition of done:** Given any technician outcome, the endpoint produces a schema-valid service request that passes shared fixture tests.

### A-10 - User-facing decision evidence [P0]

**Owner:** You

**Purpose:** Explain why Avero chose DIY, technician, or emergency using concise structured evidence, without exposing private chain-of-thought. This is especially important for Hyperbloom AI/ML judging and for user trust.

**Inputs:** Diagnosis state, user-confirmed facts, safety flags, ruled-out basic causes, classification, confidence, and any relevant visual/history findings.

**Required output:** DecisionEvidenceContract containing observed_facts[], concerns[], ruled_out_basics[], decision, confidence, uncertainty_notes[], and what_would_change_decision[].

**Database writes:** `decision_evidence` JSON snapshot on diagnosis_sessions or a separate decision_events table.

**API/Interface:** GET /api/diagnosis/:id/evidence

**Consumed by:** Diagnosis summary UI, Hyperbloom demo, service ticket explanation, debugging, and history-aware follow-up.

**Definition of done:** The UI can render a short "Why Avero recommends this" panel from structured fields alone. It never displays hidden model reasoning or chain-of-thought.

### B-01 - Provider directory and discovery [P0]

**Owner:** Aaima

**Purpose:** Find service providers who match category and service area.

**Inputs:** ServiceRequestContract category, location/service area, urgency, optional preferred time.

**Required output:** provider_candidates array with provider_id, name, categories, rating, review_count, service_area, contact channel, verification status.

**Database writes:** providers and provider_categories; optional cached discovery results.

**API/Interface:** POST /api/marketplace/discover

**Consumed by:** Request distribution.

**Definition of done:** A plumbing/electrical/AC request returns at least three plausible seeded providers for the demo. Production adapter can later use Google Places or another source.

### B-02 - Request distribution [P0]

**Owner:** Aaima

**Purpose:** Send the standardized job to selected providers without coupling the core product to one messaging channel.

**Inputs:** service_request_id and selected provider_ids.

**Required output:** dispatch records with status sent/delivered/responded/expired.

**Database writes:** provider_dispatches.

**API/Interface:** POST /api/service-requests/:id/dispatch

**Consumed by:** Provider portal and future WhatsApp/SMS adapters.

**Definition of done:** For hackathon, dispatching makes the job appear in the provider portal. Channel adapter interface is documented for future WhatsApp/SMS.

### B-03 - Provider portal and quote submission [P0]

**Owner:** Aaima

**Purpose:** Give test technicians a realistic way to accept/decline and submit price, availability, warranty, parts notes, or an unstructured message.

**Inputs:** Dispatched job.

**Required output:** RawProviderResponse object and offer draft.

**Database writes:** provider_responses, offers.

**API/Interface:** GET /api/provider/jobs, POST /api/provider/jobs/:id/respond

**Consumed by:** Quote normalization.

**Definition of done:** Three providers can independently respond to one request from browser/mobile and the responses are stored.

### B-04 - AI quote normalization [P0]

**Owner:** Aaima

**Purpose:** Turn inconsistent provider replies or voice-note transcripts into comparable fields.

**Inputs:** Raw provider response text/form fields plus original service request.

**Required output:** NormalizedOfferContract with visit fee, estimate range, parts inclusion, arrival window, warranty, notes, assumptions, extraction confidence, missing_fields[], and normalization_warnings[].

**Database writes:** offers normalized fields and raw_response.

**API/Interface:** POST /api/offers/:id/normalize

**Consumed by:** Offer ranking and customer comparison UI.

**Definition of done:** Messy responses such as '1500 visit, 7 pm, parts separate' become structured offers without losing the raw response. Ambiguous or missing details remain explicitly unknown instead of being invented.

### B-05 - Offer ranking and recommendation explanation [P0]

**Owner:** Aaima

**Purpose:** Compare offers transparently instead of recommending an unexplained winner.

**Inputs:** Normalized offers, user preferences, provider reputation, urgency.

**Required output:** RankedOffer[] with total score and score_breakdown for price, availability, rating, warranty, and fit; recommended_offer_id; structured recommendation evidence; concise explanation.

**Database writes:** offer_rankings snapshot.

**API/Interface:** GET /api/service-requests/:id/ranked-offers

**Consumed by:** Customer comparison/selection screen.

**Definition of done:** At least three offers render in the same comparable fields and Avero explains why one is recommended.

### B-06 - Booking lifecycle [P0]

**Owner:** Aaima

**Purpose:** Convert a selected offer into a trackable appointment/job.

**Inputs:** selected offer, requested slot, user/home/service request.

**Required output:** booking_id, confirmed price basis, provider, appointment window, booking status.

**Database writes:** bookings.

**API/Interface:** POST /api/bookings, GET /api/bookings/:id, POST /api/bookings/:id/cancel

**Consumed by:** Payment, provider job workflow, Home History.

**Definition of done:** Selecting an offer creates one booking and prevents accidental duplicate active bookings for the same request.

### B-07 - Payment protection and deposit [P0]

**Owner:** Aaima

**Purpose:** Let the platform mediate the transaction and reduce trust risk without claiming unimplemented legal escrow.

**Inputs:** booking_id, agreed visit/deposit amount, payment method in sandbox.

**Required output:** payment_id, deposit amount, payment status, protection status, receipt reference.

**Database writes:** payments, payment_events.

**API/Interface:** POST /api/bookings/:id/payment-intent, POST /api/payments/:id/confirm

**Consumed by:** Booking confirmation and completion flow.

**Definition of done:** Demo uses payment-provider test mode or a clearly labeled sandbox. UI says 'Payment protected by Avero'. Do not call it escrow unless the production payment structure legally supports escrow.

### B-08 - Final bill, approval, and payout state [P0]

**Owner:** Aaima

**Purpose:** Handle the common case where final labor/parts differ from the initial visit fee or estimate.

**Inputs:** booking, technician final bill, parts/labor lines, amount already paid.

**Required output:** FinalBillContract, remaining_balance, user approval status, payment completion status, provider payout state.

**Database writes:** final_bills, payments, payout_state.

**API/Interface:** POST /api/bookings/:id/final-bill, POST /api/bookings/:id/approve-final-bill, POST /api/bookings/:id/complete

**Consumed by:** Repair record generation and review.

**Definition of done:** Technician submits a final bill, homeowner approves it, payment becomes complete, and job can move to completed.

### B-09 - Disputes and cancellation protection [P1]

**Owner:** Aaima

**Purpose:** Demonstrate that payment protection has an operational meaning when a technician does not arrive or the job is contested.

**Inputs:** booking/payment plus issue category and user note.

**Required output:** dispute_id, dispute status, funds action recommendation, admin-needed boolean.

**Database writes:** disputes and payment_events.

**API/Interface:** POST /api/bookings/:id/disputes, GET /api/disputes/:id

**Consumed by:** Customer/provider status screens and admin later.

**Definition of done:** At least one no-show/disputed demo fixture can enter a disputed state without marking the job completed or paying out.

### B-10 - Review and warranty capture [P1]

**Owner:** Aaima

**Purpose:** Close the trust loop and create structured warranty data for future Avero conversations.

**Inputs:** Completed booking, rating, review, warranty promised in offer/final bill.

**Required output:** review_id, warranty_start, warranty_end, warranty_terms.

**Database writes:** reviews, warranties.

**API/Interface:** POST /api/bookings/:id/review

**Consumed by:** Provider reputation and Home History.

**Definition of done:** Completed jobs can receive a rating and warranty dates can be queried later.

### C-01 - Home History record generation [P0]

**Owner:** Aaima

**Purpose:** Automatically convert completed repair data into a durable home maintenance record.

**Inputs:** Completed booking, diagnosis summary, final bill, technician, warranty, work-performed note.

**Required output:** RepairRecordContract with repair_record_id, home_id, optional asset_id, issue, work_done, amount_paid, technician, completion date, warranty, attachments.

**Database writes:** repair_records, optional home_assets linkage.

**API/Interface:** POST /api/bookings/:id/generate-repair-record or automatic completion hook.

**Consumed by:** You: Home History UI and future diagnostic context.

**Definition of done:** Completing a booking automatically produces one repair record with no manual duplicate entry by the homeowner.

### C-02 - Home History UI [P0]

**Owner:** You

**Purpose:** Give the homeowner a useful timeline of repairs, costs, providers, and warranty status.

**Inputs:** RepairRecordContract[] for home_id.

**Required output:** Timeline/cards with issue, work done, amount, technician, warranty, linked asset, and details view.

**Database writes:** No new write required for read-only MVP.

**API/Interface:** GET /api/homes/:homeId/history, GET /api/repair-records/:id

**Consumed by:** Homeowner and future agent context.

**Definition of done:** A completed demo repair appears in Home History immediately after completion.

### C-03 - History-aware maintenance agent [P0]

**Owner:** You

**Purpose:** Use prior repairs and active warranties to avoid redundant diagnosis and improve retention.

**Inputs:** New complaint plus relevant repair records/home assets.

**Required output:** history_context, related_repair_ids, possible_repeat_issue, active_warranty_match, warranty_reuse_recommendation, suggested_next_action, confidence.

**Database writes:** diagnosis_session reference to related repair_record_id.

**API/Interface:** GET /api/homes/:homeId/context?query=...

**Consumed by:** Adaptive diagnostic interview.

**Definition of done:** Demo case can say an AC was repaired recently and Avero surfaces the related repair and active warranty before recommending a new paid service. The recommendation must cite the structured repair record it used.

### C-04 - Home asset profiles [P2]

**Owner:** You

**Purpose:** Associate repairs with persistent items such as ACs, water heaters, appliances, or rooms.

**Inputs:** Asset name/type, optional make/model/serial/photo, repair links.

**Required output:** home_asset_id and asset history.

**Database writes:** home_assets.

**API/Interface:** POST /api/homes/:homeId/assets, GET /api/assets/:id

**Consumed by:** History-aware diagnosis and maintenance reminders later.

**Definition of done:** One appliance can display multiple historical repair records.

## 7. Integration Contracts

### 7.1 Service request handoff: You -> Aaima
```json
{
  "request_id": "sr_001",
  "user_id": "usr_001",
  "home_id": "home_001",
  "diagnosis_session_id": "diag_001",
  "category": "plumbing",
  "issue_summary": "Kitchen sink leaks only while water is running",
  "likely_issue": "Loose or leaking drain connection near P-trap",
  "diagnostic_confidence": 0.82,
  "urgency": "medium",
  "classification": "technician",
  "safety_flags": [],
  "facts": [
    "Leak stops when tap is off",
    "Water appears below sink cabinet",
    "User could not safely loosen fitting"
  ],
  "location": {
    "city": "Islamabad",
    "service_area": "F-10"
  },
  "preferred_windows": ["today_evening"],
  "attachments": [],
  "status": "open"
}
```

### 7.2 Normalized provider offer: Aaima -> Customer UI
```json
{
  "offer_id": "off_101",
  "service_request_id": "sr_001",
  "provider_id": "pro_007",
  "visit_fee": 1500,
  "currency": "PKR",
  "estimated_total_min": 1500,
  "estimated_total_max": 3500,
  "parts_included": false,
  "arrival_window": "19:00-20:00",
  "warranty_days": 7,
  "raw_response": "1500 visit, can come 7ish, parts separate, 7 day service warranty",
  "extraction_confidence": 0.94
}
```

### 7.3 Completed repair record: Aaima -> Home History
```json
{
  "repair_record_id": "rr_401",
  "home_id": "home_001",
  "asset_id": null,
  "service_request_id": "sr_001",
  "booking_id": "bk_201",
  "issue_summary": "Kitchen sink leaking",
  "diagnosis": "Loose drain connection near P-trap",
  "work_done": "P-trap connection reseated and seal replaced",
  "provider_name": "Ahmed Plumbing Services",
  "amount_paid": 3200,
  "currency": "PKR",
  "completed_at": "2026-09-14T19:45:00+05:00",
  "warranty_end": "2026-09-21",
  "notes": "No further leak observed after 10 minute test"
}
```

## 8. Required Shared Enums

```text
classification: diy | technician | emergency
urgency: low | medium | high | immediate
service_request_status: draft | open | offers_received | selected | booked | in_progress | completed | cancelled | disputed
booking_status: pending_payment | confirmed | provider_en_route | in_progress | awaiting_final_bill | awaiting_customer_approval | completed | cancelled | disputed
payment_status: pending | authorized | paid | partially_paid | protected | refund_pending | refunded | disputed | payout_released
diy_status: not_started | in_progress | resolved | failed | escalated | stopped
```

## 9. Integration Rules

- No feature may consume another person's internal database shape directly. Cross-owner communication uses shared contracts only.
- Every shared JSON contract must be validated with a schema such as Zod before it is accepted by the downstream feature.
- IDs are generated once and passed through the workflow. Never create a second service request for the same handoff because an endpoint was retried.
- Raw AI/provider text is stored alongside normalized fields so bad extraction can be debugged and shown transparently.
- All money fields use integer minor units or a clearly agreed integer currency convention. Do not mix strings, floats, and formatted currency.
- All timestamps are ISO 8601. Store UTC in the database if convenient, but include timezone-aware display logic.
- Enums live only in the shared contracts package. Neither person creates private variants such as 'tech_needed' versus 'technician'.
- All status-changing POST endpoints should be idempotent or reject illegal duplicate transitions.
- Each owner provides at least one valid fixture and one failure fixture for every cross-team contract they emit.
- Do not merge a breaking contract change until both owners have updated their consumer/producer branches.

## 10. Recommended Repository Structure
```text
avero/
  apps/
    customer/              # You: homeowner UI, voice, diagnosis, DIY, history UI
    provider/              # Aaima: provider inbox, response, job/final bill UI
  services/
    maintenance-agent/     # You: diagnosis, safety, classification, DIY orchestration
    marketplace/           # Aaima: discovery, dispatch, offer normalization/ranking
    payments/              # Aaima: sandbox payment and protection states
    history/               # Aaima writes repair record; You consumes/query context
  packages/
    contracts/             # BOTH: shared enums, Zod schemas, TypeScript interfaces
    ui/                    # optional shared design tokens/components
  supabase/
    migrations/
    seed.sql
  fixtures/
    service-requests/
    provider-responses/
    offers/
    repair-records/
  docs/
    BUILD_PLAN.md
    API_CONTRACTS.md
    AI_DISCLOSURE.md
    AI_EVALUATION.md
    DEMO_SCRIPT_NEXT_FOUNDERS.md
    DEMO_SCRIPT_HYPERBLOOM.md
  .env.example
  README.md
```

## 11. GitHub Working Agreement

1. `main` is always demoable. Never develop directly on `main`.
2. Use branches such as `shajia/diagnosis-safety`, `aaima/offer-ranking`, `shared/service-request-contract`.
3. Contract changes require a pull request and both owners' approval.
4. Every PR description must include: what changed, why, screenshots/test evidence, contract changes, database migration changes, and known limitations.
5. Prefer small PRs by feature ID, for example `A-06 guided DIY`, rather than week-long mega branches.
6. Tag integration checkpoints: `integration-1-handoff`, `integration-2-marketplace`, `integration-3-payment-history`, `demo-candidate`.
7. Keep `docs/AI_DISCLOSURE.md` updated whenever a model/provider changes. Include model name, provider, feature IDs, and whether the call handles text, vision, voice, extraction, or ranking.
8. Do not merge an AI feature without fixture evidence showing normal behavior and a failure/uncertainty case.

## 12. Database Model

Core tables: users, homes, home_assets, diagnosis_sessions, diagnosis_messages, attachments, safety_events, decision_events, ai_events, diy_sessions, diy_step_events, service_requests, providers, provider_categories, provider_dispatches, provider_responses, offers, offer_rankings, bookings, payments, payment_events, final_bills, disputes, warranties, reviews, repair_records.

Hackathon rule: create only the columns needed by P0 first. Add P1/P2 tables after the full P0 flow works end to end.

## 13. Payment and Business Model

**Primary startup model:** Avero takes a transaction commission on successfully completed bookings. The maintenance agent can remain free to maximize acquisition. A later provider subscription can add verified badge, lead analytics, CRM tools, or priority tools, but paid placement must never secretly control the recommendation score.

**Payment flow:** selected offer -> booking -> booking deposit/visit fee -> protected status -> technician performs work -> technician submits final bill -> homeowner approves -> remaining balance paid -> payout state released -> review/warranty -> Home History.

**Payment protection:** For the hackathon, demonstrate this using payment-provider test mode or a clearly labeled sandbox state machine. Do not describe the money as legal escrow unless the actual production payment provider and jurisdiction support escrow. The visible product promise is that Avero mediates payment, records agreed pricing, and supports no-show/dispute/refund states.

## 14. Home History Product Loop

Every completed booking automatically creates a repair record. The user should never have to re-enter the same repair manually. On a future complaint, Avero searches relevant history first. If the same asset has an active warranty or a similar recent repair, Avero should surface that before recommending another paid job. This is both a user-trust feature and Avero's strongest retention loop.

## 15. Hackathon Reality: What Must Be Real vs Can Be Simulated

**Must be real:** voice/text diagnosis, adaptive questions, safety interruption, DIY step flow, user-facing decision evidence, service ticket creation, provider portal response, AI quote normalization, ranked comparison, booking state, sandbox payment state, final bill, repair record, Home History update, and history-aware warranty recall. At least one AI flow must visibly change behavior because the user supplied different evidence.

**Strongly recommended for Hyperbloom:** one stable image-assisted diagnosis/DIY case, an AI evaluation fixture page or test output, and a short architecture view showing which features are AI-driven versus deterministic safety/business rules.

**Can be simulated behind a clean interface:** live WhatsApp delivery, nationwide technician database, real card settlement/payout, real emergency calling, production identity verification, full dispute operations. The demo must clearly state when an external channel is simulated rather than pretending it is live.

**AI disclosure rule:** do not describe deterministic ranking weights, safety rules, or database retrieval as AI if they are not AI. Conversely, clearly identify the features that genuinely use models. This makes the technical story more credible.

## 16. AI/ML Feature Matrix and Evaluation Targets

This matrix is the Hyperbloom-facing proof that AI is central to Avero rather than a cosmetic wrapper. Each row needs a working fixture and a visible or inspectable structured output.

| Feature | Owner | AI role | Required structured output | Minimum evaluation case |
|---|---|---|---|---|
| A-03 Adaptive interview | You | Select the next useful question from current evidence and information gaps | next_question, hypotheses, confidence, information_gaps, enough_information | Same complaint with two different answers must produce meaningfully different next questions |
| A-04 Safety guardrail | You | Detect risk signals alongside explicit safety rules | safety_level, flags, safe_to_continue, actions | Burning smell/sparks must interrupt ordinary troubleshooting |
| A-05 Outcome classifier | You | Classify DIY, technician, or emergency from structured state | classification, urgency, confidence, reason | At least one case for each class plus one reclassification case |
| A-07 Vision | You | Extract visible findings without overclaiming certainty | visual_findings, component, hazard_flags, confidence | One useful image plus one ambiguous image that triggers uncertainty |
| A-10 Decision evidence | You | Convert structured facts into concise user-facing explanation | observed facts, concerns, decision, uncertainty | Explanation must match the stored evidence and classification |
| B-04 Quote normalization | Aaima | Convert messy provider response into comparable fields | NormalizedOfferContract, warnings, confidence | Mixed Urdu/English or informal response plus missing-field case |
| B-05 Offer recommendation | Aaima | Rank offers and explain tradeoffs | ranked offers, score breakdown, recommendation evidence | Cheapest offer should not always win when urgency/warranty changes |
| C-03 History-aware context | You | Retrieve and use relevant repair/warranty context | related repair IDs, warranty match, next action | Repeat AC problem must surface the still-active warranty |

**Evaluation rule:** Accuracy is not the only goal. A safe abstention, explicit uncertainty, or escalation is preferable to a confident fabricated answer.

## 17. Build Order and Integration Checkpoints

### Sprint 0 - Contract and skeleton
Both: repository, shared contracts, Supabase schema, seed data, fixtures, design tokens, S-02 AI observability/disclosure skeleton, and separate demo-script files for each hackathon.

### Sprint 1 - Independent P0 paths
You: A-01 to A-06 plus A-08/A-09/A-10. Aaima: B-01 to B-05 with seeded service-request fixture. Both: create AI evaluation fixtures for each completed AI feature.

### Integration 1 - Technician handoff
Your real A-09 output must successfully drive Aaima B-01 to B-05 with no manual reshaping.

### Sprint 2 - Transaction layer
Aaima: B-06 to B-08 and C-01. You: customer offer/booking views, C-02 Home History UI, and C-03 history-aware recall.

### Integration 2 - Complete job loop
Real diagnosis -> service request -> three offers -> select -> booking -> sandbox payment -> final bill -> complete -> repair record -> Home History.

### Sprint 3 - Differentiators
You: A-07. Aaima: B-09/B-10. Both: polish, difficult/ambiguous AI cases, failure states, analytics/demo data, README, AI disclosure, and both hackathon demo scripts.

### Demo candidate
Freeze contracts. Fix only bugs and presentation issues. No new architecture changes.

## 18. Acceptance Scenarios

1. **DIY success:** clogged/loose low-risk case -> adaptive diagnosis -> guided steps -> user confirms resolved -> no marketplace request created.
2. **DIY escalation:** starts DIY -> user reports a new unsafe/complex condition -> Avero stops -> classification becomes technician -> service request created.
3. **Emergency interruption:** user mentions burning smell/sparks/gas/smoke -> normal diagnosis stops immediately -> concise safety actions shown.
4. **Technician marketplace:** service request -> three providers -> messy responses -> normalized offers -> one transparent recommendation.
5. **Protected transaction:** chosen offer -> deposit in sandbox -> final bill -> customer approval -> payment completed -> repair record created.
6. **History retention:** new complaint references a recent repair -> Avero detects prior record/warranty and recommends warranty reuse when applicable.
7. **Failure case:** provider no-show/dispute -> job does not become completed and Home History does not falsely record a successful repair.
8. **Decision-evidence case:** classification screen shows observed facts, concerns, uncertainty, and recommendation from structured fields, with no private chain-of-thought exposed.
9. **AI uncertainty case:** ambiguous image or provider reply produces an explicit low-confidence/missing-information result rather than invented certainty.
10. **AI traceability case:** team can identify which model/workflow produced the adaptive question, classification, quote normalization, and recommendation, and can point to the corresponding evaluation fixture.

## 19. Demo Story to Build Toward

Use the same stable product build for both submissions, but record two edits with different emphasis.

### Next Founders demo emphasis

1. Open with the fragmented home-repair problem and the startup value proposition.
2. Show a short adaptive diagnosis that ends in technician-required.
3. Show the structured job request and three provider offers.
4. Show transparent comparison, booking, Payment Protection, final bill, and completion.
5. Show the repair automatically appearing in Home History.
6. End with transaction commission, retention through Home History/warranties, and scalable provider channels.

### Hyperbloom demo emphasis

1. Open with the same homeowner problem, then quickly prove the agent is adaptive by showing a question that depends on the prior answer.
2. Show the structured safety state and DIY/technician/emergency classification.
3. Show the "Why Avero recommends this" evidence panel.
4. If stable, show one image-assisted finding or component-identification step.
5. Show the service ticket as proof that conversation becomes machine-usable structure.
6. Show a messy provider response becoming a normalized offer and compare three offers with score breakdowns.
7. Show Home History and a repeat issue that triggers active-warranty recall.
8. End with a 20-30 second emergency case where Avero interrupts normal troubleshooting, plus a brief architecture/AI disclosure view.

**Demo safety:** Pre-seed all providers and fallback fixtures. Never rely on a live third-party provider response during judging. Live AI may be used, but the demo environment needs deterministic fallback data if a model/API is temporarily unavailable.

## 20. Final Definition of Done

Avero is demo-ready only when the P0 journey works from a clean browser session without manually editing the database between steps, every cross-owner payload validates against shared contracts, both apps can run from README instructions, seeded fallback data exists, payment is clearly sandboxed, a completed repair appears automatically in Home History, history can affect a later recommendation, structured decision evidence is visible, AI failures/uncertainty are handled safely, and `AI_DISCLOSURE.md` plus `AI_EVALUATION.md` accurately describe the models and tests used. The repo must contain separate Next Founders and Hyperbloom demo scripts so the same build can be presented with the correct emphasis.
