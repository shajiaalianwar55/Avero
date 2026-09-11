import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { owned, HttpError, type Database, type Row } from './database.js';
import { detectHazards, safetyState } from './safety.js';
export const MessageInput = z.object({ text: z.string().trim().min(1).max(4000), source: z.enum(['text','voice']).default('text') }).strict();
export const StartInput = MessageInput.extend({ home_id: z.string().min(1), asset_id: z.string().nullable().default(null) });
export const ImageInput = z.object({ mime_type: z.enum(['image/jpeg','image/png','image/webp']), base64: z.string().min(1).max(5600000), caption: z.string().max(500).default('') }).strict();
export class Diagnosis {
  constructor(readonly db: Database) {}
  async session(id: string, user: string) { return owned(this.db, 'diagnosis_sessions', id, user); }
  async persist(row: Row) { return this.db.save('diagnosis_sessions', row); }
  async start(user: string, raw: unknown) {
    const input = StartInput.parse(raw); await owned(this.db, 'homes', input.home_id, user);
    if (input.asset_id) { const asset = await owned(this.db, 'assets', input.asset_id, user); if (asset.home_id !== input.home_id) throw new HttpError(400, 'Appliance belongs to another home'); }
    const row = await this.persist({ id: `diag_${randomUUID()}`, user_id: user, home_id: input.home_id, payload: { complaint: input.text, asset_id: input.asset_id, safety: safetyState([], true), revision: 0, classification: null, interview: null, related_record_ids: [], visual_assessments: [] } });
    await this.message(row.id, user, { text: input.text, source: input.source }); return this.session(row.id, user);
  }
  async message(id: string, user: string, raw: unknown) {
    const input = MessageInput.parse(raw); const row = await this.session(id, user);
    if ((await this.db.list('diagnosis_messages', {session_id:id})).length >= 60) throw new HttpError(409, 'Session limit reached. Start a new check.');
    const flags = [...row.payload.safety.safety_flags, ...detectHazards(input.text)];
    row.payload.safety = safetyState(flags, true); row.payload.revision++;
    row.payload.classification = flags.length ? { classification:'emergency', reason:'Safety red flags detected', urgency:'immediate', confidence:1, recommended_next_action:'Stop and seek emergency assistance.' } : null;
    row.payload.interview = null; row.payload.summary = null; row.payload.decision_evidence = null;
    // Persist stop state before the message so a partial failure cannot bypass safety.
    await this.persist(row);
    await this.db.save('diagnosis_messages', { id:`msg_${randomUUID()}`, user_id:user, session_id:id, payload:{ ...input, role:'user', revision:row.payload.revision }, created_at:new Date().toISOString() });
    await this.db.save('safety_events', {id:`safe_${randomUUID()}`, user_id:user, session_id:id, payload:row.payload.safety});
    return row;
  }
  async attach(id: string, user: string, raw: unknown) {
    const row = await this.session(id, user); const input = ImageInput.parse(raw);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new HttpError(400, 'Invalid image encoding');
    const bytes = Buffer.from(input.base64, 'base64');
    const valid = input.mime_type === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : input.mime_type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
    if (!valid || bytes.length > 4 * 1024 * 1024) throw new HttpError(400, 'Use a JPEG, PNG or WebP image under 4 MB');
    if ((await this.db.list('attachments', { session_id:id })).length >= 5) throw new HttpError(409, 'Maximum five images per check');
    row.payload.safety = safetyState([...row.payload.safety.safety_flags, ...detectHazards(input.caption)], true); row.payload.classification = null; row.payload.interview = null; row.payload.summary = null; row.payload.decision_evidence = null; row.payload.revision++;
    await this.persist(row);
    const attachment = await this.db.save('attachments', { id:`att_${randomUUID()}`, user_id:user, session_id:id, payload:input });
    return { attachment_id: attachment.id, kind:'image', storage_path:`/api/attachments/${attachment.id}`, mime_type:input.mime_type, caption:input.caption };
  }
  async messages(id: string, user: string) { await this.session(id,user); return (await this.db.list('diagnosis_messages',{session_id:id,user_id:user})).sort((a,b)=>a.created_at.localeCompare(b.created_at)); }
}
