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

export type ProviderCandidate = z.infer<typeof ProviderCandidateSchema>;
export type DiscoverByRequestId = z.infer<typeof DiscoverByRequestIdSchema>;
export type DiscoverMatchCriteria = z.infer<typeof DiscoverMatchCriteriaSchema>;
export type DiscoverResult = z.infer<typeof DiscoverResultSchema>;
