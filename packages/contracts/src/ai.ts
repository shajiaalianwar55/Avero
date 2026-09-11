import { z } from "zod";

export const AIFeatureIdSchema = z.enum([
  "A-03", "A-04", "A-05", "A-07", "A-10", "B-04", "B-05", "C-03",
]);

export const AIExecutionStateSchema = z.enum(["success", "fallback", "error", "abstained"]);

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));

export const AITraceEventSchema = z.object({
  event_id: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
  feature_id: AIFeatureIdSchema,
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  prompt_version: z.string().trim().min(1),
  input_record_id: z.string().trim().min(1),
  output_record_id: z.string().trim().min(1).nullable(),
  latency_ms: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).nullable(),
  validation_passed: z.boolean(),
  structured_output: z.record(z.string(), JsonValueSchema).nullable(),
  structured_evidence: z.record(z.string(), JsonValueSchema),
  safety_rule_hits: z.array(z.string().trim().min(1)),
  execution_state: AIExecutionStateSchema,
  error_code: z.string().trim().min(1).nullable(),
  fallback_reason: z.string().trim().min(1).nullable(),
}).strict().superRefine((event, context) => {
  if (event.execution_state === "error" && event.error_code === null) {
    context.addIssue({ code: "custom", message: "error events require error_code", path: ["error_code"] });
  }
  if ((event.execution_state === "fallback" || event.execution_state === "abstained") && event.fallback_reason === null) {
    context.addIssue({ code: "custom", message: "fallback and abstained events require fallback_reason", path: ["fallback_reason"] });
  }
  if (event.execution_state === "success" && !event.validation_passed) {
    context.addIssue({ code: "custom", message: "success requires validation_passed", path: ["validation_passed"] });
  }
});

export const AIEvaluationCaseSchema = z.object({
  case_id: z.string().trim().min(1),
  feature_id: AIFeatureIdSchema,
  kind: z.enum(["normal", "difficult", "safe_failure"]),
  description: z.string().trim().min(1),
  input_record_id: z.string().trim().min(1),
  input: z.record(z.string(), JsonValueSchema),
  expected_output: z.record(z.string(), JsonValueSchema),
  assertions: z.object({
    validation_passed: z.boolean(),
    execution_state: AIExecutionStateSchema,
    confidence_at_most: z.number().min(0).max(1).nullable(),
    required_safety_rule_hits: z.array(z.string().trim().min(1)),
  }).strict(),
}).strict();

export type AIFeatureId = z.infer<typeof AIFeatureIdSchema>;
export type AIExecutionState = z.infer<typeof AIExecutionStateSchema>;
export type AITraceEvent = z.infer<typeof AITraceEventSchema>;
export type AIEvaluationCase = z.infer<typeof AIEvaluationCaseSchema>;
