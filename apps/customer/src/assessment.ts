import { z } from 'zod';
import { AI } from './ai.js';
import { Diagnosis } from './diagnosis.js';
import { safetyState } from './safety.js';
const strings = z.array(z.string());
export const InterviewSchema = z.object({next_question:z.string().nullable(),hypotheses:strings,confidence:z.number().min(0).max(1),information_gaps:strings,enough_information:z.boolean(),category:z.string(),diy_guide:z.enum(['remote_batteries','none'])}).strict();
export const SafetySchema = z.object({hazard_flags:strings,uncertain:z.boolean(),confidence:z.number().min(0).max(1)}).strict();
export const OutcomeSchema = z.object({classification:z.enum(['diy','technician','emergency']),reason:z.string(),urgency:z.enum(['low','medium','high','immediate']),confidence:z.number().min(0).max(1),recommended_next_action:z.string()}).strict();
export const technician = (reason = 'A qualified technician should assess this issue.') => ({classification:'technician' as const,reason,urgency:'medium' as const,confidence:0,recommended_next_action:'Request a qualified technician. Do not attempt repairs.'});
export class Assessment {
  constructor(readonly diagnosis: Diagnosis, readonly ai: AI) {}
  async safety(id: string, user: string) {
    const row = await this.diagnosis.session(id,user);
    if(row.payload.safety_revision===row.payload.revision) return row.payload.safety;
    if (row.payload.safety.safety_flags.length) { row.payload.safety = safetyState(row.payload.safety.safety_flags); await this.diagnosis.persist(row); return row.payload.safety; }
    const messages = (await this.diagnosis.messages(id,user)).map(x=>x.payload);
    const result = await this.ai.run('A-04',id,SafetySchema,'Detect ALL safety red flags including gas, fire, electricity, water near electricity, structural instability and unsafe user capabilities. Only mark uncertain=false if context permits safe non-invasive observation. No repair instructions.',{messages,visual_assessments:row.payload.visual_assessments},{hazard_flags:[],uncertain:true,confidence:0});
    const attachments = await this.diagnosis.db.list('attachments',{session_id:id,user_id:user});
    const unassessed = attachments.some(a=>!row.payload.visual_assessments.some((v:{attachment_id:string;available:boolean})=>v.attachment_id===a.id && v.available));
    row.payload.safety = safetyState(result.output.hazard_flags,!result.available || result.output.uncertain || unassessed);
    row.payload.safety_revision=row.payload.revision;
    await this.diagnosis.persist(row);
    await this.diagnosis.db.save('safety_events',{id:`safe_${crypto.randomUUID()}`,user_id:user,session_id:id,payload:row.payload.safety}); return row.payload.safety;
  }
  async next(id: string, user: string) {
    const safety = await this.safety(id,user); const row = await this.diagnosis.session(id,user);
    if (!safety.safe_to_continue) { row.payload.classification = safety.safety_flags.length ? {classification:'emergency',reason:'Safety red flags detected.',urgency:'immediate',confidence:1,recommended_next_action:safety.immediate_actions.join(' ')} : technician('Safety could not be confirmed.'); await this.diagnosis.persist(row); return {next_question:null,hypotheses:[],confidence:0,information_gaps:['Professional safety assessment'],enough_information:false,category:'general',diy_guide:'none',safety,available:false}; }
    if (row.payload.interview) return {...row.payload.interview,safety};
    const messages = (await this.diagnosis.messages(id,user)).map(x=>x.payload);
    const result = await this.ai.run('A-03',id,InterviewSchema,'Ask ONE useful, observational follow-up question based on the actual answers. Do not ask the user to touch, open, disconnect, test electrical components or approach hazards. Stop when sufficient information exists. Consider supplied repair history; an active warranty should be checked before a new paid service. diy_guide=remote_batteries only when a handheld remote has been identified, weak/empty batteries are likely, and the user explicitly confirmed a dry, intact, cool battery compartment with no corrosion, leakage or swelling. Otherwise none.',{messages,safety,visual_assessments:row.payload.visual_assessments,history_context:row.payload.history_context ?? null},{next_question:null,hypotheses:[],confidence:0,information_gaps:['AI assessment unavailable'],enough_information:false,category:'general',diy_guide:'none'});
    row.payload.interview = {...result.output,available:result.available};
    if (result.output.next_question) await this.diagnosis.db.save('diagnosis_messages',{id:`msg_${crypto.randomUUID()}`,user_id:user,session_id:id,payload:{role:'assistant',text:result.output.next_question},created_at:new Date().toISOString()});
    if (!result.available) row.payload.classification = technician('Diagnostic assessment unavailable.');
    await this.diagnosis.persist(row); return {...row.payload.interview,safety};
  }
  async classify(id:string,user:string) {
    const safety = await this.safety(id,user); const row = await this.diagnosis.session(id,user);
    if (safety.safety_flags.length) row.payload.classification = {classification:'emergency',reason:'Safety red flags detected.',urgency:'immediate',confidence:1,recommended_next_action:safety.immediate_actions.join(' ')};
    else if (!safety.safe_to_continue || !row.payload.interview?.available) row.payload.classification = technician('Safety or diagnosis could not be confirmed.');
    else {
      const result = await this.ai.run('A-05',id,OutcomeSchema,'Choose one current outcome. DIY is permitted ONLY for the vetted remote_batteries guide with enough_information=true and confidence>=0.8. Everything else needs a technician; hazards need emergency assistance. Do not invent repair steps.',{interview:row.payload.interview,safety,messages:(await this.diagnosis.messages(id,user)).map(m=>m.payload)},technician('Classification unavailable.'));
      row.payload.classification = result.output;
      if(result.output.classification==='emergency') row.payload.safety=safetyState(['model_detected_emergency']);
      if (result.output.classification==='diy' && (row.payload.interview.diy_guide!=='remote_batteries' || !row.payload.interview.enough_information || row.payload.interview.confidence<0.8)) row.payload.classification = technician('No approved low-risk guide matches the evidence.');
    }
    row.payload.summary = null; row.payload.decision_evidence = null;
    await this.diagnosis.persist(row); return row.payload.classification;
  }
}
