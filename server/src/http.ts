import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Hono } from 'hono';

/**
 * A small bridge so the app needs no Node adapter dependency: a web Request goes
 * in, a web Response comes out, and bodies stream both ways. `x-real-ip` and
 * `x-forwarded-proto` come from the host nginx in production.
 */
export function listen(app: Hono, { host, port }: { host: string; port: number }) {
  const server = createServer((req, res) => {
    handle(app, req, res).catch((error) => {
      console.error('request failed', error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('internal error');
    });
  });
  server.listen(port, host);
  return server;
}

async function handle(app: Hono, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const host = req.headers.host ?? 'localhost';
  const url = `${proto === 'https' ? 'https' : 'http'}://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (key.toLowerCase() === 'set-cookie') continue;
      headers.append(key, item);
    }
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit);

  const response = await app.fetch(request);

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie' || key.toLowerCase() === 'content-length') return;
    res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);

  if (!response.body || req.method === 'HEAD') {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as never), res);
}
