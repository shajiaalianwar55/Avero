import { z } from "zod";
import { PaymentStatusSchema } from "./enums.js";

/** B-07 sandbox-only payment method (no live card capture). */
export const SandboxPaymentMethodSchema = z.enum(["sandbox_card"]);

export const PaymentIntentInputSchema = z.object({
  method: SandboxPaymentMethodSchema.default("sandbox_card"),
  amount: z.number().int().positive().optional(),
}).strict();

export const ConfirmPaymentInputSchema = z.object({
  sandbox_result: z.enum(["succeeded"]).default("succeeded"),
}).strict();

export const PaymentProtectionStatusSchema = z.enum(["intent", "avero_protected"]);

/** Sandbox deposit payment — mediated by Avero; not legal escrow. */
export const PaymentContractSchema = z.object({
  payment_id: z.string().trim().min(1),
  booking_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  deposit_amount: z.number().int().nonnegative(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  status: PaymentStatusSchema,
  method: SandboxPaymentMethodSchema,
  protection_status: PaymentProtectionStatusSchema,
  protection_label: z.literal("Payment protected by Avero"),
  sandbox: z.literal(true),
  sandbox_disclosure: z.literal("Sandbox payment — not legal escrow"),
  receipt_reference: z.string().trim().min(1).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export type SandboxPaymentMethod = z.infer<typeof SandboxPaymentMethodSchema>;
export type PaymentIntentInput = z.infer<typeof PaymentIntentInputSchema>;
export type ConfirmPaymentInput = z.infer<typeof ConfirmPaymentInputSchema>;
export type PaymentProtectionStatus = z.infer<typeof PaymentProtectionStatusSchema>;
export type PaymentContract = z.infer<typeof PaymentContractSchema>;
