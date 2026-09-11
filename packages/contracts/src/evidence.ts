import { z } from 'zod';
export const DecisionEvidenceContractSchema = z.object({
  observed_facts:z.array(z.string()), concerns:z.array(z.string()), ruled_out_basics:z.array(z.string()),
  decision:z.enum(['diy','technician','emergency']),confidence:z.number().min(0).max(1),
  uncertainty_notes:z.array(z.string()),what_would_change_decision:z.array(z.string()),
}).strict();
export type DecisionEvidenceContract = z.infer<typeof DecisionEvidenceContractSchema>;
