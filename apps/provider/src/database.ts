import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Row = Record<string, any>;

export interface Database {
  list(table: string, filters?: Record<string, string>): Promise<Row[]>;
  save(table: string, row: Row): Promise<Row>;
}

export class SupabaseDatabase implements Database {
  constructor(readonly client: SupabaseClient) {}

  async list(table: string, filters: Record<string, string> = {}) {
    let query = this.client.from(table).select('*');
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error } = await query.limit(1000);
    if (error) throw new HttpError(503, 'Database operation failed. Check migrations and configuration.');
    return data ?? [];
  }

  async save(table: string, row: Row) {
    const { data, error } = await this.client.from(table).upsert(row).select().single();
    if (error) throw new HttpError(503, 'Database write failed. Check migrations and configuration.');
    return data as Row;
  }
}

export function configuredDatabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  return new SupabaseDatabase(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
