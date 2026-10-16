import { z } from "zod";

/** B-10 homeowner review body for a completed booking. */
export const CreateReviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
}).strict();

export const ReviewContractSchema = z.object({
  review_id: z.string().trim().min(1),
  booking_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  home_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  provider_name: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).nullable(),
  warranty_id: z.string().trim().min(1),
  warranty_start: z.iso.date(),
  warranty_end: z.iso.date().nullable(),
  warranty_terms: z.string().trim().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export const WarrantyContractSchema = z.object({
  warranty_id: z.string().trim().min(1),
  review_id: z.string().trim().min(1),
  booking_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  home_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  warranty_start: z.iso.date(),
  warranty_end: z.iso.date().nullable(),
  warranty_terms: z.string().trim().min(1),
  warranty_days: z.number().int().nonnegative().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export type CreateReviewInput = z.infer<typeof CreateReviewInputSchema>;
export type ReviewContract = z.infer<typeof ReviewContractSchema>;
export type WarrantyContract = z.infer<typeof WarrantyContractSchema>;
