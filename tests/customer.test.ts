import { describe, it, expect } from 'vitest';
import { HomeInputSchema } from '@avero/contracts';
import { owned, type Database, type Row } from '../apps/customer/src/database.js';
import { Diagnosis } from '../apps/customer/src/diagnosis.js';
import { detectHazards } from '../apps/customer/src/safety.js';
export class MemoryDatabase implements Database {
  tables: Record<string, Row[]> = {};
  async list(table: string, filters: Record<string, string> = {}) { return structuredClone((this.tables[table] ?? []).filter(row => Object.entries(filters).every(([key,value]) => row[key] === value))); }
  async save(table: string, row: Row) { const rows = this.tables[table] ??= []; const index = rows.findIndex(item => item.id === row.id); if (index < 0) rows.push(structuredClone(row)); else rows[index] = {...rows[index], ...structuredClone(row)}; return structuredClone(row); }
}
describe('customer boundaries', () => {
  it.each(['gas smell','burning socket','exposed wire','standing water near electricity','smoke/fire','structural instability'])('interrupts %s', text => expect(detectHazards(text).length).toBeGreaterThan(0));
  it('stores voice transcripts and never clears a previous emergency', async () => {
    const db = new MemoryDatabase(); await db.save('homes',{id:'home1',user_id:'alice'}); const service = new Diagnosis(db);
    const session = await service.start('alice',{home_id:'home1',text:'I smell gas',source:'voice'});
    const updated = await service.message(session.id,'alice',{text:'It is fine now'});
    expect(updated.payload.safety.safe_to_continue).toBe(false); expect(updated.payload.classification.classification).toBe('emergency');
    expect((await service.messages(session.id,'alice'))[0]?.payload.source).toBe('voice');
    await expect(service.message(session.id,'bob',{text:'hello'})).rejects.toMatchObject({status:404});
  });
  it('rejects injected ownership fields', () => { expect(HomeInputSchema.safeParse({ label:'Home', city:'Islamabad', service_area:'F-10', user_id:'victim' }).success).toBe(false); });
  it('cannot read another user home', async () => { const db = new MemoryDatabase(); await db.save('homes', {id:'home1',user_id:'alice'}); await expect(owned(db,'homes','home1','bob')).rejects.toMatchObject({status:404}); expect((await owned(db,'homes','home1','alice')).id).toBe('home1'); });
});
