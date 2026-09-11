# AI disclosure

This document identifies where Avero uses a model, where deterministic rules remain authoritative, and what is retained for debugging. It must be updated whenever a provider, model snapshot, prompt version, or feature boundary changes.

## Runtime default

- Provider: OpenAI
- API: Responses API (planned integration; no model calls are implemented in S-02)
- Pinned model: `gpt-5.4-mini-2026-03-17`
- Configuration: `AI_PROVIDER`, `AI_MODEL_DEFAULT`, and per-feature prompt-version environment variables

The pinned model accepts text and image inputs and supports Structured Outputs, which match Avero's schema-first extraction and classification needs. See the [official OpenAI model reference](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

## Feature register

| Feature | Model role | Modality | Prompt version | Deterministic boundary |
|---|---|---|---|---|
| A-03 Adaptive interview | Select the next useful question and identify information gaps | Text | `a03.v1` | Session state and schema validation |
| A-04 Safety guardrail | Detect contextual risk signals | Text | `a04.v1` | Explicit hazard rules always run and can stop the flow without the model |
| A-05 Outcome classifier | Propose DIY, technician, or emergency from structured state | Text | `a05.v1` | Safety overrides and allowed enum transitions |
| A-07 Vision | Extract visible findings and uncertainty | Image + text | `a07.v1` | Confidence threshold and unsafe-image abstention |
| A-10 Decision evidence | Turn stored evidence into a concise explanation | Text | `a10.v1` | Explanation may cite only supplied evidence fields |
| B-04 Quote normalization | Extract comparable fields from informal provider text | Text | `b04.v1` | Zod contract; missing values remain `null` |
| B-05 Offer recommendation | Explain tradeoffs from normalized scores and preferences | Text | `b05.v1` | Price, availability, rating, warranty scores, and paid-placement exclusion are deterministic |
| C-03 History-aware context | Summarize retrieved repair and warranty context and next action | Text | `c03.v1` | Database retrieval and warranty-date comparison are deterministic |

Until a feature is integrated, this register describes its approved runtime default, not a claim that the feature is already live.

## Data retention and transparency

`AITraceEvent` stores feature and model metadata, record references, latency, confidence, validation state, validated structured output, structured evidence, safety-rule hits, and explicit error or fallback state. It does not store hidden chain-of-thought, scratchpads, or private reasoning. The shared helper rejects common private-reasoning field names before persistence.

Raw user or provider content stays in its source record under that record's retention policy. The trace points to source and output record IDs and contains only evidence safe to retain. User-facing explanations are generated from structured evidence, never from hidden reasoning.

## Simulated and non-AI behavior

Safety rules, validation, ranking weights, database retrieval, provider seeding, payment states, and fallback fixtures are deterministic. S-02 supplies observability and evaluation infrastructure only; it does not claim that any planned model call, WhatsApp or SMS delivery, emergency calling, payment settlement, or nationwide discovery is live.
