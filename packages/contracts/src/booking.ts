import { z } from "zod";
import { BookingStatusSchema } from "./enums.js";

/** B-06 create body: selected offer + requested appointment window. */
export const CreateBookingInputSchema = z.object({
  offer_id: z.string().trim().min(1),
  appointment_window: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
}).strict();

export const PriceBasisSchema = z.object({
  amount: z.number().int().nonnegative().nullable(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  basis: z.enum(["visit_fee", "estimated_total_min", "unspecified"]),
}).strict();

/** Trackable appointment/job created from a selected offer. */
export const BookingContractSchema = z.object({
  booking_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  offer_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  provider_name: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  home_id: z.string().trim().min(1),
  status: BookingStatusSchema,
  appointment_window: z.string().trim().min(1).max(200),
  price_basis: PriceBasisSchema,
  notes: z.string().trim().max(2000).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  cancelled_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export type CreateBookingInput = z.infer<typeof CreateBookingInputSchema>;
export type PriceBasis = z.infer<typeof PriceBasisSchema>;
export type BookingContract = z.infer<typeof BookingContractSchema>;
