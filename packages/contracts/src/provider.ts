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
