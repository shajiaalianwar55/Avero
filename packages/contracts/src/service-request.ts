import { z } from "zod";
import { ClassificationSchema, ServiceRequestStatusSchema, UrgencySchema } from "./enums.js";

export const ServiceLocationSchema = z.object({
  city: z.string().trim().min(1),
  service_area: z.string().trim().min(1),
}).strict();

export const AttachmentReferenceSchema = z.object({
  attachment_id: z.string().trim().min(1),
  kind: z.enum(["image", "audio", "document"]),
  storage_path: z.string().trim().min(1),
}).strict();

export const ServiceRequestContractSchema = z.object({
  request_id: z.string().trim().min(1),
  user_id: z.string().trim().min(1),
  home_id: z.string().trim().min(1),
  diagnosis_session_id: z.string().trim().min(1),
  category: z.string().trim().min(1),
  issue_summary: z.string().trim().min(1),
  likely_issue: z.string().trim().min(1).nullable(),
  diagnostic_confidence: z.number().min(0).max(1),
  urgency: UrgencySchema,
  classification: ClassificationSchema,
  safety_flags: z.array(z.string().trim().min(1)),
  facts: z.array(z.string().trim().min(1)).min(1),
  location: ServiceLocationSchema,
  preferred_windows: z.array(z.string().trim().min(1)),
  attachments: z.array(AttachmentReferenceSchema),
  status: ServiceRequestStatusSchema,
}).strict();

export type ServiceRequestContract = z.infer<typeof ServiceRequestContractSchema>;
