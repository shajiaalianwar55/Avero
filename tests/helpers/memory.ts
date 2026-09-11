import type { Database, Row } from '../../apps/customer/src/database.js';
export class MemoryDatabase implements Database {
  tables: Record<string, Row[]> = {};
  async list(table: string, filters: Record<string, string> = {}) { return structuredClone((this.tables[table] ?? []).filter(row => Object.entries(filters).every(([key,value]) => row[key] === value))); }
  async save(table: string, row: Row) { const rows = this.tables[table] ??= []; const key = table==='ai_events'?'event_id':'id'; const index = rows.findIndex(item => item[key] === row[key]); if (index < 0) rows.push(structuredClone(row)); else rows[index] = {...rows[index], ...structuredClone(row)}; return structuredClone(row); }
}
