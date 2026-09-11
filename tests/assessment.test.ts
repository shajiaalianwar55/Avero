import { describe,it,expect } from 'vitest';
import { MemoryDatabase } from './customer.test.js';
import { Diagnosis } from '../apps/customer/src/diagnosis.js';
import { AI } from '../apps/customer/src/ai.js';
import { Assessment } from '../apps/customer/src/assessment.js';
const safe = {hazard_flags:[],uncertain:false,confidence:0.9};
const interview = {next_question:'Does the remote indicator light come on?',hypotheses:['Empty batteries'],confidence:0.6,information_gaps:['Indicator state'],enough_information:false,category:'appliance',diy_guide:'none'};
describe('live workflow with injected model transport',()=>{
  it.each(['normal','difficult','safe_failure'])('validates the %s interview result',async kind=>{
    const db = new MemoryDatabase(); await db.save('homes',{id:'h',user_id:'u'}); const diagnosis = new Diagnosis(db);
    const row = await diagnosis.start('u',{home_id:'h',text:'Remote does not work'});
    const ai = new AI(db,async req=> 'hazard_flags' in (req.schema.properties as object) ? safe : kind==='safe_failure' ? {made_up:true} : {...interview,next_question:kind==='normal'?'Does the indicator light come on?':'Which device is the remote for?'});
    const result = await new Assessment(diagnosis,ai).next(row.id,'u');
    expect(result.available).toBe(kind!=='safe_failure'); expect(result.next_question).toBe(kind==='safe_failure'?null:kind==='normal'?'Does the indicator light come on?':'Which device is the remote for?');
    expect(db.tables.ai_events?.length).toBeGreaterThan(0);
  });
  it('provider failure prevents DIY and does not fabricate a diagnosis',async()=>{
    const db = new MemoryDatabase(); await db.save('homes',{id:'h',user_id:'u'}); const diagnosis = new Diagnosis(db); const row = await diagnosis.start('u',{home_id:'h',text:'Remote problem'});
    const assessment = new Assessment(diagnosis,new AI(db,async()=>{throw Error('offline');}));
    expect((await assessment.classify(row.id,'u')).classification).toBe('technician');
    expect((await diagnosis.session(row.id,'u')).payload.safety.safe_to_continue).toBe(false);
  });
});
