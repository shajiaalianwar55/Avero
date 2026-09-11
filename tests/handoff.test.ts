import {it,expect} from 'vitest';
import {MemoryDatabase} from './helpers/memory.js';
import {Diagnosis} from '../apps/customer/src/diagnosis.js';
import {Handoff} from '../apps/customer/src/handoff.js';
import {AI} from '../apps/customer/src/ai.js';
import {technician} from '../apps/customer/src/assessment.js';
import {ServiceRequestContractSchema} from '@avero/contracts';
it('ticket validates, preserves marketplace status on retry and rejects a later emergency',async()=>{
 const db=new MemoryDatabase(); await db.save('homes',{id:'h',user_id:'u',city:'Lahore',service_area:'Gulberg'}); const d=new Diagnosis(db); const row=await d.start('u',{home_id:'h',text:'Tap leaks'}); row.payload.classification=technician(); await d.persist(row); const handoff=new Handoff(d,new AI(db,async()=>{throw Error('offline');}));
 const ticket=await handoff.ticket('u',{diagnosis_session_id:row.id}); expect(ServiceRequestContractSchema.safeParse(ticket).success).toBe(true);
 await db.save('service_requests',{...(db.tables.service_requests?.[0]),status:'booked'}); expect((await handoff.ticket('u',{diagnosis_session_id:row.id})).status).toBe('booked'); expect(db.tables.service_requests).toHaveLength(1);
 await d.message(row.id,'u',{text:'There is exposed wire'}); await expect(handoff.ticket('u',{diagnosis_session_id:row.id})).rejects.toMatchObject({status:409});
});
it('evidence fallback is structured and factual',async()=>{const db=new MemoryDatabase();await db.save('homes',{id:'h',user_id:'u'});const d=new Diagnosis(db);const row=await d.start('u',{home_id:'h',text:'Tap leaks'});row.payload.classification=technician();await d.persist(row);const result=await new Handoff(d,new AI(db,async()=>({bad:true}))).evidence(row.id,'u');expect(result.observed_facts).toEqual(['Tap leaks']);expect(result.ruled_out_basics).toEqual([]);});
