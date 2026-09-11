import { z } from "zod";

export const NormalizedOfferContractSchema = z.object({
  offer_id: z.string().trim().min(1),
  service_request_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  visit_fee: z.number().int().nonnegative().nullable(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  estimated_total_min: z.number().int().nonnegative().nullable(),
  estimated_total_max: z.number().int().nonnegative().nullable(),
  parts_included: z.boolean().nullable(),
  arrival_window: z.string().trim().min(1).nullable(),
  warranty_days: z.number().int().nonnegative().nullable(),
  raw_response: z.string().trim().min(1),
  extraction_confidence: z.number().min(0).max(1),
}).strict().refine(
  ({ estimated_total_min, estimated_total_max }) =>
    estimated_total_min === null || estimated_total_max === null || estimated_total_min <= estimated_total_max,
  { message: "estimated_total_min must not exceed estimated_total_max", path: ["estimated_total_max"] },
);

export type NormalizedOfferContract = z.infer<typeof NormalizedOfferContractSchema>;
