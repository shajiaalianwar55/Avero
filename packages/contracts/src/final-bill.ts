import { z } from "zod";
import { PaymentStatusSchema } from "./enums.js";

export const FinalBillLineKindSchema = z.enum(["labor", "parts", "other"]);

export const FinalBillLineSchema = z.object({
  kind: FinalBillLineKindSchema,
  description: z.string().trim().min(1).max(500),
  amount: z.number().int().nonnegative(),
}).strict();

/** B-08 technician final bill submission. */
export const SubmitFinalBillInputSchema = z.object({
  lines: z.array(FinalBillLineSchema).min(1).max(50),
  currency: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

export const FinalBillApprovalStatusSchema = z.enum(["pending", "approved"]);
export const PayoutStateSchema = z.enum(["not_ready", "pending_release", "released"]);

export const FinalBillContractSchema = z.object({
  final_bill_id: z.string().trim().min(1),
  booking_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  payment_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  lines: z.array(FinalBillLineSchema).min(1),
  total_amount: z.number().int().nonnegative(),
  amount_already_paid: z.number().int().nonnegative(),
  remaining_balance: z.number().int().nonnegative(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  approval_status: FinalBillApprovalStatusSchema,
  payment_status: PaymentStatusSchema,
  payout_state: PayoutStateSchema,
  notes: z.string().trim().max(2000).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  approved_at: z.iso.datetime({ offset: true }).nullable(),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export type FinalBillLine = z.infer<typeof FinalBillLineSchema>;
export type SubmitFinalBillInput = z.infer<typeof SubmitFinalBillInputSchema>;
export type FinalBillApprovalStatus = z.infer<typeof FinalBillApprovalStatusSchema>;
export type PayoutState = z.infer<typeof PayoutStateSchema>;
export type FinalBillContract = z.infer<typeof FinalBillContractSchema>;
