import { z } from "zod";

export const RepairRecordContractSchema = z.object({
  repair_record_id: z.string().trim().min(1),
  home_id: z.string().trim().min(1),
  asset_id: z.string().trim().min(1).nullable(),
  service_request_id: z.string().trim().min(1),
  booking_id: z.string().trim().min(1),
  issue_summary: z.string().trim().min(1),
  diagnosis: z.string().trim().min(1),
  work_done: z.string().trim().min(1),
  provider_name: z.string().trim().min(1),
  amount_paid: z.number().int().nonnegative(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  completed_at: z.iso.datetime({ offset: true }),
  warranty_end: z.iso.date().nullable(),
  notes: z.string().trim().min(1).nullable(),
}).strict();

export type RepairRecordContract = z.infer<typeof RepairRecordContractSchema>;
