import { z } from 'zod';
import { DecisionEvidenceContractSchema, ServiceRequestContractSchema } from '@avero/contracts';
import { Diagnosis } from './diagnosis.js';
import { AI } from './ai.js';
import { owned, HttpError } from './database.js';
const Input = z.object({diagnosis_session_id:z.string(),preferred_windows:z.array(z.string().trim().min(1).max(100)).max(10).default([])}).strict();
export class Handoff {
  constructor(readonly diagnosis:Diagnosis,readonly ai:AI) {}
  async summary(id:string,user:string) {
    const row=await this.diagnosis.session(id,user); const state=row.payload; const outcome=state.classification;
    if (!outcome) throw new HttpError(409,'Classify this check first');
    const facts=(await this.diagnosis.messages(id,user)).filter(m=>m.payload.role==='user').map(m=>m.payload.text as string);
    const result={problem_summary:state.complaint,likely_issue:state.interview?.hypotheses?.[0] ?? null,alternatives:state.interview?.hypotheses?.slice(1) ?? [],urgency:outcome.urgency,confidence:outcome.confidence,recommended_action:outcome.recommended_next_action,safety_notes:[...state.safety.safety_flags,...state.safety.immediate_actions],observed_evidence:facts,uncertainty_notes:[...(state.interview?.information_gaps ?? ['Issue not confirmed']),...(!state.safety.safe_to_continue?['Do not continue troubleshooting.']:[])]};
    row.payload.summary=result; await this.diagnosis.persist(row); return result;
  }
  async evidence(id:string,user:string) {
    const row=await this.diagnosis.session(id,user); if (row.payload.decision_evidence) return row.payload.decision_evidence;
    const summary=await this.summary(id,user); const fallback=DecisionEvidenceContractSchema.parse({observed_facts:summary.observed_evidence,concerns:summary.safety_notes,ruled_out_basics:[],decision:row.payload.classification.classification,confidence:summary.confidence,uncertainty_notes:summary.uncertainty_notes,what_would_change_decision:['A qualified professional confirms the cause and safety conditions.']});
    const result=await this.ai.run('A-10',id,DecisionEvidenceContractSchema,'Produce brief user-facing evidence, NOT private reasoning. observed_facts must be exact strings selected from supplied observed_evidence. ruled_out_basics must be empty unless explicitly confirmed by a user fact, using that exact fact. Never change the supplied decision/confidence. Explain remaining uncertainty, not a definitive diagnosis.',{...summary,decision:fallback.decision},fallback);
    const evidence=result.output;
    evidence.observed_facts=evidence.observed_facts.filter(f=>summary.observed_evidence.includes(f));
    evidence.ruled_out_basics=evidence.ruled_out_basics.filter(f=>summary.observed_evidence.includes(f));
    evidence.decision=fallback.decision; evidence.confidence=fallback.confidence; evidence.concerns=[...new Set([...fallback.concerns,...evidence.concerns])];
    row.payload.summary=summary; row.payload.decision_evidence=evidence; await this.diagnosis.persist(row); return evidence;
  }
  async ticket(user:string,raw:unknown) {
    const input=Input.parse(raw); const row=await this.diagnosis.session(input.diagnosis_session_id,user);
    if (row.payload.safety.safety_flags.length || row.payload.classification?.classification!=='technician') throw new HttpError(409,'Only a current technician outcome can create a ticket');
    const id=`sr_${row.id}`; const existing=(await this.diagnosis.db.list('service_requests',{id,user_id:user}))[0];
    if (existing) return ServiceRequestContractSchema.parse({...existing.payload,status:existing.status});
    const home=await owned(this.diagnosis.db,'homes',row.home_id,user); const summary=await this.summary(row.id,user);
    const attachments=(await this.diagnosis.db.list('attachments',{session_id:row.id,user_id:user})).map(a=>({attachment_id:a.id,kind:'image',storage_path:`/api/attachments/${a.id}`}));
    const ticket=ServiceRequestContractSchema.parse({request_id:id,user_id:user,home_id:row.home_id,diagnosis_session_id:row.id,category:row.payload.interview?.category || 'general',issue_summary:summary.problem_summary,likely_issue:summary.likely_issue,diagnostic_confidence:summary.confidence,urgency:summary.urgency,classification:'technician',safety_flags:row.payload.safety.safety_flags,facts:summary.observed_evidence,location:{city:home.city,service_area:home.service_area},preferred_windows:input.preferred_windows,attachments,status:'open'});
    await this.diagnosis.db.save('service_requests',{id,user_id:user,home_id:row.home_id,diagnosis_session_id:row.id,payload:ticket,status:'open'}); return ticket;
  }
}
