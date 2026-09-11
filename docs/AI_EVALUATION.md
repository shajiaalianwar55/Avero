# AI evaluation

Avero evaluates every model-assisted feature against schema validity, safe uncertainty, and product-specific behavior. Accuracy alone is insufficient: abstention or escalation is preferable to a confident fabricated result.

## Fixture gate

Each feature in the build plan has exactly three baseline cases under `fixtures/ai-evaluations`:

- `normal`: expected structured success
- `difficult`: ambiguity, mixed evidence, or a meaningful tradeoff
- `safe_failure`: model failure, missing evidence, or an input that must abstain or escalate

Run the complete gate with:

```bash
npm run check
```

The evaluation validator fails when any feature lacks one of the three case kinds. Contract tests also validate representative success, ambiguity, and deterministic-fallback `AITraceEvent` records.

Customer feature tests inject success, ambiguous, invalid-output, and provider-failure responses, so the suite is reproducible and does not spend API credits. `npm run test:integration` verifies the real local Supabase/auth boundary, while `npm run test:browser` exercises desktop and mobile UI flows. Run a separate live synthetic Structured Outputs smoke test when changing provider or model configuration; that check incurs normal provider usage.

## Feature targets

| Feature | Required behavior |
|---|---|
| A-03 | Prior answers change the next question; missing complaints abstain |
| A-04 | Burning smell, sparks, gas, or smoke interrupt ordinary troubleshooting even during model failure |
| A-05 | Covers DIY, technician, emergency, and safety-driven reclassification |
| A-07 | Useful images yield bounded findings; ambiguous images state uncertainty |
| A-10 | Explanations match stored facts and do not invent evidence |
| B-04 | Informal or mixed-language replies normalize known fields and preserve unknowns |
| B-05 | Cheapest does not always win when availability, reputation, warranty, and urgency differ |
| C-03 | Related repair IDs support warranty reuse; lookup failure does not claim history is empty |

## Execution protocol

1. Validate the fixture and feature output schemas before scoring behavior.
2. Run each case against the pinned model snapshot and prompt version from `AI_DISCLOSURE.md`.
3. Record an `AITraceEvent` with source and output record IDs, latency, confidence when available, rule hits, validation result, and execution state.
4. Compare structured output with the fixture assertions. Do not score or retain hidden reasoning.
5. Treat an invalid output as a failure and invoke the feature's deterministic fallback or abstention path.
6. Review regressions before changing a prompt or model; bump the prompt version whenever expected behavior changes.

## Current status

The schema, trace helper, database table, disclosure, 24 baseline cases, customer model runner, and deterministic fallbacks are implemented. A live synthetic check against the configured pinned model was schema-valid on 2026-09-12. This is a connectivity check, not a measured quality pass rate. Evaluation results must distinguish model output from deterministic safety, validation, retrieval, and ranking behavior.
