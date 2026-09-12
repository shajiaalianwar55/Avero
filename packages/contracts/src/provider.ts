import { z } from "zod";
import { UrgencySchema } from "./enums.js";

/** Comparable provider row returned by B-01 discovery. contact_channel is null until a real channel is stored. */
export const ProviderCandidateSchema = z.object({
  provider_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  categories: z.array(z.string().trim().min(1)),
  rating: z.number().min(0).max(5).nullable(),
  review_count: z.number().int().nonnegative(),
  service_area: z.string().trim().min(1),
  contact_channel: z.null(),
  verification_status: z.string().trim().min(1),
}).strict();

export const DiscoverByRequestIdSchema = z.object({
  service_request_id: z.string().trim().min(1),
}).strict();

export const DiscoverMatchCriteriaSchema = z.object({
  category: z.string().trim().min(1),
  city: z.string().trim().min(1),
  service_area: z.string().trim().min(1),
  urgency: UrgencySchema,
  preferred_windows: z.array(z.string().trim().min(1)),
}).strict();

export const DiscoverResultSchema = z.object({
  service_request_id: z.string().trim().min(1),
  request_id: z.string().trim().min(1),
  match_criteria: DiscoverMatchCriteriaSchema,
  provider_candidates: z.array(ProviderCandidateSchema),
}).strict();

/** B-02 dispatch lifecycle. Portal channel marks delivered immediately so B-03 can list jobs. */
export const DispatchStatusSchema = z.enum(["sent", "delivered", "responded", "expired"]);
export const DispatchChannelSchema = z.enum(["portal"]);

export const DispatchInputSchema = z.object({
  provider_ids: z.array(z.string().trim().min(1)).min(1).max(20),
}).strict();

export const ProviderDispatchSchema = z.object({
  dispatch_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  channel: DispatchChannelSchema,
  status: DispatchStatusSchema,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export const DispatchResultSchema = z.object({
  service_request_id: z.string().trim().min(1),
  channel: DispatchChannelSchema,
  dispatches: z.array(ProviderDispatchSchema).min(1),
}).strict();

export type ProviderCandidate = z.infer<typeof ProviderCandidateSchema>;
export type DiscoverByRequestId = z.infer<typeof DiscoverByRequestIdSchema>;
export type DiscoverMatchCriteria = z.infer<typeof DiscoverMatchCriteriaSchema>;
export type DiscoverResult = z.infer<typeof DiscoverResultSchema>;
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;
export type DispatchChannel = z.infer<typeof DispatchChannelSchema>;
export type DispatchInput = z.infer<typeof DispatchInputSchema>;
export type ProviderDispatch = z.infer<typeof ProviderDispatchSchema>;
export type DispatchResult = z.infer<typeof DispatchResultSchema>;

/** B-03 raw response before B-04 normalization. */
export const ProviderDecisionSchema = z.enum(["accept", "decline"]);

export const ProviderRespondInputSchema = z.object({
  provider_id: z.string().trim().min(1),
  decision: ProviderDecisionSchema,
  message: z.string().trim().max(4000).default(""),
  visit_fee: z.number().int().nonnegative().nullable().optional(),
  estimated_total_min: z.number().int().nonnegative().nullable().optional(),
  estimated_total_max: z.number().int().nonnegative().nullable().optional(),
  parts_included: z.boolean().nullable().optional(),
  arrival_window: z.string().trim().min(1).max(200).nullable().optional(),
  warranty_days: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).default("PKR"),
}).strict().superRefine((value, context) => {
  if (value.decision === "accept" && !value.message && value.visit_fee == null && !value.arrival_window) {
    context.addIssue({
      code: "custom",
      message: "Accept requires a message or at least visit fee / arrival window",
      path: ["message"],
    });
  }
  if (
    value.estimated_total_min != null
    && value.estimated_total_max != null
    && value.estimated_total_min > value.estimated_total_max
  ) {
    context.addIssue({
      code: "custom",
      message: "estimated_total_min must not exceed estimated_total_max",
      path: ["estimated_total_max"],
    });
  }
});

export const RawProviderResponseSchema = z.object({
  response_id: z.string().trim().min(1),
  dispatch_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  decision: ProviderDecisionSchema,
  raw_response: z.string().trim().min(1),
  created_at: z.iso.datetime({ offset: true }),
}).strict();

export const ProviderJobSchema = z.object({
  dispatch_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  status: DispatchStatusSchema,
  channel: DispatchChannelSchema,
  created_at: z.iso.datetime({ offset: true }),
  issue_summary: z.string().trim().min(1),
  category: z.string().trim().min(1),
  urgency: UrgencySchema,
  location: z.object({
    city: z.string().trim().min(1),
    service_area: z.string().trim().min(1),
  }).strict(),
}).strict();

export const ProviderRespondResultSchema = z.object({
  response: RawProviderResponseSchema,
  offer_draft: z.record(z.string(), z.unknown()).nullable(),
  dispatch_status: DispatchStatusSchema,
}).strict();

export type ProviderDecision = z.infer<typeof ProviderDecisionSchema>;
export type ProviderRespondInput = z.infer<typeof ProviderRespondInputSchema>;
export type RawProviderResponse = z.infer<typeof RawProviderResponseSchema>;
export type ProviderJob = z.infer<typeof ProviderJobSchema>;
export type ProviderRespondResult = z.infer<typeof ProviderRespondResultSchema>;
