import { z } from 'zod';
import { owned, HttpError, type Row } from './database.js';
import { Diagnosis } from './diagnosis.js';
import { technician } from './assessment.js';
export const guide = {
  tools:['New batteries of the type specified on the remote or in its manual'],
  safety_preconditions:['Handheld remote only, disconnected from any charging cable.', 'Battery compartment is dry, cool, undamaged, and free of leakage, corrosion or swelling.', 'Keep batteries away from children and pets. Never mix battery types or old and new batteries.'],
  stop_conditions:['Heat, leakage, corrosion, swelling, damaged compartment, unfamiliar battery type, or anything different from the instructions.'],
  fallback_action:'Stop and ask a qualified technician or the device manufacturer.',
  steps:[{instruction:'Using only the normal tool-free cover, open the remote battery compartment. If it will not open easily, stop.',expected_result:'The dry, intact battery compartment is accessible.'},{instruction:'Replace the batteries with new ones of the exact specified type, following the marked + and − polarity. Close the cover.',expected_result:'Matching batteries are seated correctly and the cover closes normally.'},{instruction:'Try the remote normally while pointing it at its device.',expected_result:'The device responds to the remote.'}]
};
const Start = z.object({diagnosis_session_id:z.string(),preconditions_confirmed:z.literal(true),tools_available:z.literal(true)}).strict();
const Result = z.object({step_index:z.number().int().nonnegative(),result:z.enum(['done','different','failure','stop']),note:z.string().max(1000).default('')}).strict();
export class DIY {
  constructor(readonly diagnosis:Diagnosis) {}
  view(row:Row) { return {guide_id:row.id,...guide,...row.payload,current_step:row.payload.status==='active'?guide.steps[row.payload.step_index]:null,expected_result:row.payload.status==='active'?guide.steps[row.payload.step_index]?.expected_result:null,steps:undefined}; }
  async start(user:string,raw:unknown) {
    const input = Start.parse(raw); const session = await this.diagnosis.session(input.diagnosis_session_id,user);
    if (!session.payload.safety.safe_to_continue || session.payload.classification?.classification!=='diy' || session.payload.interview?.diy_guide!=='remote_batteries') throw new HttpError(409,'A confirmed low-risk DIY outcome is required');
    const existing = (await this.diagnosis.db.list('diy_sessions',{session_id:session.id,user_id:user}))[0]; if (existing) return this.view(existing);
    const row = await this.diagnosis.db.save('diy_sessions',{id:`diy_${session.id}`,user_id:user,session_id:session.id,payload:{step_index:0,status:'active',revision:session.payload.revision}}); return this.view(row);
  }
  async result(id:string,user:string,raw:unknown) {
    const input = Result.parse(raw); const row = await owned(this.diagnosis.db,'diy_sessions',id,user); let session = await this.diagnosis.session(row.session_id,user);
    if (row.payload.status!=='active' || input.step_index!==row.payload.step_index) throw new HttpError(409,'This step has already changed. Reload the guide.');
    if (input.note) { await this.diagnosis.message(row.session_id,user,{text:input.note}); session = await this.diagnosis.session(row.session_id,user); }
    if (input.result!=='done' || !session.payload.safety.safe_to_continue || session.payload.revision!==row.payload.revision || session.payload.classification?.classification!=='diy') {
      row.payload.status = 'stopped';
      if (!session.payload.safety.safety_flags.length) session.payload.classification = technician('DIY stopped or conditions changed. A technician should assess this.');
      session.payload.summary = null; session.payload.decision_evidence = null;
      await this.diagnosis.persist(session);
    } else { row.payload.step_index++; if (row.payload.step_index>=guide.steps.length) row.payload.status='completed'; }
    await this.diagnosis.db.save('diy_sessions',row);
    await this.diagnosis.db.save('diy_step_events',{id:`${id}_${input.step_index}`,user_id:user,guide_id:id,payload:input});
    return {...this.view(row),safety:session.payload.safety,classification:session.payload.classification};
  }
}
