import { describe, it, expect } from 'vitest';
import { HomeInputSchema } from '@avero/contracts';
import { owned, type Database, type Row } from '../apps/customer/src/database.js';
export class MemoryDatabase implements Database {
  tables: Record<string, Row[]> = {};
  async list(table: string, filters: Record<string, string> = {}) { return structuredClone((this.tables[table] ?? []).filter(row => Object.entries(filters).every(([key,value]) => row[key] === value))); }
  async save(table: string, row: Row) { const rows = this.tables[table] ??= []; const index = rows.findIndex(item => item.id === row.id); if (index < 0) rows.push(structuredClone(row)); else rows[index] = {...rows[index], ...structuredClone(row)}; return structuredClone(row); }
}
describe('customer boundaries', () => {
  it('rejects injected ownership fields', () => { expect(HomeInputSchema.safeParse({ label:'Home', city:'Islamabad', service_area:'F-10', user_id:'victim' }).success).toBe(false); });
  it('cannot read another user home', async () => { const db = new MemoryDatabase(); await db.save('homes', {id:'home1',user_id:'alice'}); await expect(owned(db,'homes','home1','bob')).rejects.toMatchObject({status:404}); expect((await owned(db,'homes','home1','alice')).id).toBe('home1'); });
});
