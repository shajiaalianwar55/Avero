import { z } from 'zod';
import { RepairRecordContractSchema } from '@avero/contracts';
import { owned, HttpError, type Database } from './database.js';
import { AI } from './ai.js';
const AssetInput=z.object({name:z.string().trim().min(1).max(100),type:z.string().trim().min(1).max(100),make:z.string().max(100).default(''),model:z.string().max(100).default(''),serial:z.string().max(100).default(''),photo_attachment_id:z.string().nullable().default(null)}).strict();
export const RecallSchema=z.object({related_repair_ids:z.array(z.string()),possible_repeat_issue:z.boolean(),confidence:z.number().min(0).max(1)}).strict();
export function activeWarranty(end:string|null,now=new Date()) { return !!end && end>=now.toISOString().slice(0,10); }
const keywords=(text:string)=>new Set(text.toLowerCase().replace(/air[ -]?condition(?:er|ing)/g,'ac').match(/[a-z0-9]{2,}/g)?.filter(w=>!['the','was','with','this','that','have','again','does','not','and','recently','repaired','problem'].includes(w)) ?? []);
export class History {
 constructor(readonly db:Database,readonly ai:AI) {}
 async records(home:string,user:string) { await owned(this.db,'homes',home,user); return (await this.db.list('repair_records',{home_id:home})).map(r=>RepairRecordContractSchema.parse(r.payload)).filter(r=>r.home_id===home).sort((a,b)=>b.completed_at.localeCompare(a.completed_at)); }
 async record(id:string,user:string) { const row=(await this.db.list('repair_records',{id}))[0]; if(!row)throw new HttpError(404,'Repair not found'); await owned(this.db,'homes',row.home_id,user); const result=RepairRecordContractSchema.parse(row.payload); if(result.home_id!==row.home_id)throw new HttpError(409,'Repair home mismatch'); return {...result,warranty_active:activeWarranty(result.warranty_end)}; }
 async assets(home:string,user:string) { await owned(this.db,'homes',home,user); return (await this.db.list('home_assets',{home_id:home,user_id:user})).map(row=>({home_asset_id:row.id,home_id:home,...row.payload})); }
 async addAsset(home:string,user:string,raw:unknown) { await owned(this.db,'homes',home,user); const input=AssetInput.parse(raw);
   if(input.photo_attachment_id) { const image=await owned(this.db,'attachments',input.photo_attachment_id,user); const session=await owned(this.db,'diagnosis_sessions',image.session_id,user); if(session.home_id!==home)throw new HttpError(400,'Photo belongs to another home'); }
   const id=`asset_${crypto.randomUUID()}`; await this.db.save('home_assets',{id,user_id:user,home_id:home,payload:input});return {home_asset_id:id,home_id:home,...input};
 }
 async asset(id:string,user:string) { const row=await owned(this.db,'home_assets',id,user); return {home_asset_id:id,home_id:row.home_id,...row.payload,history:(await this.records(row.home_id,user)).filter(r=>r.asset_id===id)}; }
 async context(home:string,user:string,query:string,assetId:string|null=null) {
   z.string().trim().min(1).max(4000).parse(query); const records=await this.records(home,user); const words=keywords(query);
   const candidates=records.filter(r=>r.asset_id===assetId && assetId!==null || [...keywords(`${r.issue_summary} ${r.diagnosis} ${r.work_done}`)].some(w=>words.has(w))).slice(0,20);
   const fallback={related_repair_ids:candidates.map(r=>r.repair_record_id),possible_repeat_issue:candidates.length>0,confidence:candidates.length?0.4:0};
   const result=candidates.length ? await this.ai.run('C-03',home,RecallSchema,'Select relevant prior repair IDs from the supplied records only. Similar symptoms are not proof of the same cause. Do not infer warranty coverage; dates are handled separately.',{query,records:candidates},fallback) : {output:fallback,available:true};
   const allowed=new Set(candidates.map(r=>r.repair_record_id)); const ids=[...new Set(result.output.related_repair_ids.filter(id=>allowed.has(id)))];
   // Always surface plausible active warranties even when the model misses them.
   for(const record of candidates) if(activeWarranty(record.warranty_end)&&!ids.includes(record.repair_record_id))ids.push(record.repair_record_id);
   const related=candidates.filter(r=>ids.includes(r.repair_record_id)); const active=related.filter(r=>activeWarranty(r.warranty_end));
   return {history_context:related.map(r=>({repair_record_id:r.repair_record_id,issue_summary:r.issue_summary,work_done:r.work_done,provider_name:r.provider_name,completed_at:r.completed_at,warranty_end:r.warranty_end})),related_repair_ids:ids,possible_repeat_issue:ids.length>0,active_warranty_match:active.length>0,warranty_reuse_recommendation:active.length?`Contact ${active.map(r=>`${r.provider_name} about repair ${r.repair_record_id} (warranty through ${r.warranty_end})`).join('; ')} before paying for another visit. Confirm that this issue is covered.`:null,suggested_next_action:active.length?'Contact the previous provider to confirm warranty coverage. Safety emergencies take priority.':'Continue a safety-first assessment.',confidence:result.output.confidence,available:result.available};
 }
}
