import { z } from "zod";

export const ClassificationSchema = z.enum(["diy", "technician", "emergency"]);
export const UrgencySchema = z.enum(["low", "medium", "high", "immediate"]);
export const ServiceRequestStatusSchema = z.enum([
  "draft", "open", "offers_received", "selected", "booked", "in_progress", "completed", "cancelled", "disputed",
]);
export const BookingStatusSchema = z.enum([
  "pending_payment", "confirmed", "provider_en_route", "in_progress", "awaiting_final_bill",
  "awaiting_customer_approval", "completed", "cancelled", "disputed",
]);
export const PaymentStatusSchema = z.enum([
  "pending", "authorized", "paid", "partially_paid", "protected", "refund_pending", "refunded", "disputed", "payout_released",
]);
export const DiyStatusSchema = z.enum([
  "not_started", "in_progress", "resolved", "failed", "escalated", "stopped",
]);

export type Classification = z.infer<typeof ClassificationSchema>;
export type Urgency = z.infer<typeof UrgencySchema>;
export type ServiceRequestStatus = z.infer<typeof ServiceRequestStatusSchema>;
export type BookingStatus = z.infer<typeof BookingStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type DiyStatus = z.infer<typeof DiyStatusSchema>;
