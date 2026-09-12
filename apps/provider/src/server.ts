import { createServer } from 'node:http';
import { z } from 'zod';
import { configuredDatabase, HttpError } from './database.js';
import { Discover } from './discover.js';
import { body, json } from './http.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* deployment can supply environment */
}

const db = configuredDatabase();
const discover = new Discover(db);
const port = Number.parseInt(process.env.PROVIDER_APP_PORT ?? '3001', 10);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ app: 'provider', status: 'ok' }));
      return;
    }

    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'Sign in to continue');
    const { data, error } = await db.client.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Session expired. Sign in again.');

    if (path === '/api/marketplace/discover' && request.method === 'POST') {
      return json(response, 200, await discover.run(data.user.id, await body(request)));
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
