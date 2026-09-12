import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { configuredDatabase, HttpError } from './database.js';
import { Discover } from './discover.js';
import { Dispatch } from './dispatch.js';
import { Portal } from './portal.js';
import { Normalize } from './normalize.js';
import { body, json } from './http.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* deployment can supply environment */
}

const db = configuredDatabase();
const discover = new Discover(db);
const dispatch = new Dispatch(db);
const portal = new Portal(db, dispatch);
const normalize = new Normalize(db);
const port = Number.parseInt(process.env.PROVIDER_APP_PORT ?? '3001', 10);
const staticFiles: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ app: 'provider', status: 'ok' }));
      return;
    }

    if (path === '/api/config') {
      return json(response, 200, {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
      });
    }

    const asset = staticFiles[path];
    if (asset && request.method === 'GET') {
      const content = await readFile(fileURLToPath(new URL(`../public/${asset[0]}`, import.meta.url)));
      response.writeHead(200, { 'content-type': asset[1], 'x-content-type-options': 'nosniff' });
      return response.end(content);
    }

    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'Sign in to continue');
    const { data, error } = await db.client.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Session expired. Sign in again.');

    if (path === '/api/marketplace/discover' && request.method === 'POST') {
      return json(response, 200, await discover.run(data.user.id, await body(request)));
    }

    const dispatchMatch = path.match(/^\/api\/service-requests\/([^/]+)\/dispatch$/);
    if (dispatchMatch && request.method === 'POST') {
      return json(response, 201, await dispatch.run(data.user.id, dispatchMatch[1]!, await body(request)));
    }

    if (path === '/api/providers' && request.method === 'GET') {
      return json(response, 200, await portal.providers());
    }

    if (path === '/api/provider/jobs' && request.method === 'GET') {
      const providerId = url.searchParams.get('provider_id');
      if (!providerId) throw new HttpError(400, 'Invalid request fields');
      return json(response, 200, await portal.jobs(providerId));
    }

    const respondMatch = path.match(/^\/api\/provider\/jobs\/([^/]+)\/respond$/);
    if (respondMatch && request.method === 'POST') {
      return json(response, 201, await portal.respond(respondMatch[1]!, await body(request)));
    }

    const normalizeMatch = path.match(/^\/api\/offers\/([^/]+)\/normalize$/);
    if (normalizeMatch && request.method === 'POST') {
      await body(request);
      return json(response, 200, await normalize.run(data.user.id, normalizeMatch[1]!));
    }

    throw new HttpError(404, 'Route not found');
  } catch (error) {
    json(
      response,
      error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500,
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? 'Invalid request fields'
              : 'Unexpected server error',
      },
    );
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Provider app listening on http://127.0.0.1:${port}`);
});
