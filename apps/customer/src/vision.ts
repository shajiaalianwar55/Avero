import { z } from 'zod';
import { AI } from './ai.js';
import { Diagnosis } from './diagnosis.js';
import { owned, HttpError } from './database.js';
import { detectHazards, safetyState } from './safety.js';
export const VisionSchema = z.object({visual_findings:z.array(z.string()),relevant_component:z.string().nullable(),hazard_flags:z.array(z.string()),confidence:z.number().min(0).max(1),explanation:z.string()}).strict();
const Input = z.object({attachment_id:z.string(),question:z.string().max(500).default('What is visible?')}).strict();
export class Vision {
  constructor(readonly diagnosis:Diagnosis,readonly ai:AI) {}
  async assess(id:string,user:string,raw:unknown) {
    const input = Input.parse(raw); const row = await this.diagnosis.session(id,user); const image = await owned(this.diagnosis.db,'attachments',input.attachment_id,user);
    if (image.session_id!==id) throw new HttpError(404,'Image not found in this check');
    const result = await this.ai.run('A-07',id,VisionSchema,'Describe only visible evidence. Flag any possible hazard. A photo cannot confirm electrical safety or diagnose hidden faults. If blurry, irrelevant or ambiguous use low confidence, null component and explain the limitation. Do not recommend repairs.',{complaint:row.payload.complaint,caption:image.payload.caption,question:input.question},{visual_findings:[],relevant_component:null,hazard_flags:[],confidence:0,explanation:'Image assessment unavailable. Do not infer safety from this photo.'},`data:${image.payload.mime_type};base64,${image.payload.base64}`);
    const output = {...result.output}; const available = result.available && output.confidence>=0.6;
    if (!available) { output.relevant_component=null; output.visual_findings=[]; output.explanation='The image could not be assessed reliably. Pause DIY; use a clearer photo taken from a safe location or contact a professional.'; }
    const assessment = {attachment_id:image.id,...output,available};
    row.payload.visual_assessments = [...row.payload.visual_assessments.filter((v:{attachment_id:string})=>v.attachment_id!==image.id),assessment];
    row.payload.safety = safetyState([...row.payload.safety.safety_flags,...output.hazard_flags,...detectHazards(input.question)],true);
    row.payload.revision++; row.payload.interview=null; row.payload.classification=null; row.payload.summary=null; row.payload.decision_evidence=null;
    await this.diagnosis.persist(row);
    await this.diagnosis.db.save('visual_assessments',{id:`vis_${crypto.randomUUID()}`,user_id:user,session_id:id,attachment_id:image.id,payload:assessment}); return assessment;
  }
}
