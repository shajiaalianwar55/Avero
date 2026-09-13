import { z } from "zod";

/** B-09 dispute categories for no-show / contested jobs. */
export const DisputeCategorySchema = z.enum(["no_show", "quality", "other"]);

export const DisputeStatusSchema = z.enum(["open", "under_review", "resolved"]);

export const FundsActionRecommendationSchema = z.enum([
  "hold_protected_funds",
  "recommend_refund_review",
  "escalate_to_admin",
]);

export const CreateDisputeInputSchema = z.object({
  category: DisputeCategorySchema,
  note: z.string().trim().min(1).max(2000),
}).strict();

export const DisputeContractSchema = z.object({
  dispute_id: z.string().trim().min(1),
  booking_id: z.string().trim().min(1),
  payment_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  category: DisputeCategorySchema,
  note: z.string().trim().min(1).max(2000),
  status: DisputeStatusSchema,
  funds_action_recommendation: FundsActionRecommendationSchema,
  admin_needed: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export type DisputeCategory = z.infer<typeof DisputeCategorySchema>;
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>;
export type FundsActionRecommendation = z.infer<typeof FundsActionRecommendationSchema>;
export type CreateDisputeInput = z.infer<typeof CreateDisputeInputSchema>;
export type DisputeContract = z.infer<typeof DisputeContractSchema>;
