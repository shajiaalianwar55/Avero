import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { HomeInputSchema, ProfileInputSchema } from '@avero/contracts';
import { configuredDatabase, HttpError, owned } from './database.js';
import { body, json } from './http.js';
import { Diagnosis } from './diagnosis.js';
try { process.loadEnvFile('.env'); } catch { /* deployment can supply environment */ }
const db = configuredDatabase();
const diagnosis = new Diagnosis(db);
const staticFiles: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost'); const path = url.pathname;
    if (path === '/health') return json(response, 200, { app: 'customer', status: 'ok' });
    if (path === '/api/config') return json(response, 200, { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY });
    const asset = staticFiles[path];
    if (asset && request.method === 'GET') { const content = await readFile(fileURLToPath(new URL(`../public/${asset[0]}`, import.meta.url))); response.writeHead(200, { 'content-type': asset[1], 'x-content-type-options': 'nosniff' }); return response.end(content); }
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'Sign in to continue');
    const { data, error } = await db.client.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Session expired. Sign in again.');
    const userId = data.user.id;
    if (path === '/api/diagnosis/sessions' && request.method === 'POST') { const result = await diagnosis.start(userId, await body(request)); return json(response,201,{...result,diagnosis_session_id:result.id,normalized_initial_complaint:result.payload.complaint}); }
    const diagnosisMatch = path.match(/^\/api\/diagnosis\/([^/]+)(?:\/(messages|attachments))?$/);
    if (diagnosisMatch) {
      const id = diagnosisMatch[1]!; const action = diagnosisMatch[2];
      if (!action && request.method === 'GET') return json(response,200,{...await diagnosis.session(id,userId),messages:await diagnosis.messages(id,userId)});
      if (action === 'messages' && request.method === 'POST') return json(response,201,await diagnosis.message(id,userId,await body(request)));
      if (action === 'attachments' && request.method === 'POST') return json(response,201,await diagnosis.attach(id,userId,await body(request)));
    }
    const attachmentMatch = path.match(/^\/api\/attachments\/([^/]+)$/);
    if (attachmentMatch && request.method === 'GET') { const file = await owned(db,'attachments',attachmentMatch[1]!,userId); response.writeHead(200,{'Content-Type':file.payload.mime_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); return response.end(Buffer.from(file.payload.base64,'base64')); }
    if (path === '/api/profile' && request.method === 'POST') { const input = ProfileInputSchema.parse(await body(request)); return json(response, 200, await db.save('users', { id: userId, name: input.name, email: data.user.email })); }
    if (path === '/api/homes' && request.method === 'GET') return json(response, 200, await db.list('homes', { user_id: userId }));
    if (path === '/api/homes' && request.method === 'POST') {
      const input = HomeInputSchema.parse(await body(request));
      if (!(await db.list('users', { id: userId })).length) throw new HttpError(409, 'Save your profile first');
      const home = await db.save('homes', { id: `home_${randomUUID()}`, user_id: userId, ...input });
      return json(response, 201, { ...home, home_id: home.id, service_location: { city: home.city, service_area: home.service_area } });
    }
    const homeMatch = path.match(/^\/api\/homes\/([^/]+)$/);
    if (homeMatch && request.method === 'GET') return json(response, 200, await owned(db, 'homes', homeMatch[1]!, userId));
    throw new HttpError(404, 'Route not found');
  } catch (error) { json(response, error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500, { error: error instanceof HttpError ? error.message : error instanceof z.ZodError ? 'Invalid request fields' : 'Unexpected server error' }); }
});
server.listen(Number(process.env.CUSTOMER_APP_PORT ?? 3000), '127.0.0.1', () => console.log('Avero customer app ready'));
