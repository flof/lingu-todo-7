import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { MiddlewareHandler } from 'hono';

/** Everything under /api is the server's; everything else is the app shell, which
 * SPA deep links like /list/<id> also need. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function staticAssets(dir: string | null): MiddlewareHandler {
  const root = dir ? resolve(dir) : null;

  return async (c, next) => {
    if (!root || c.req.method !== 'GET' || c.req.path.startsWith('/api/')) return next();

    const candidate = resolve(join(root, c.req.path));
    if (!candidate.startsWith(root)) return next();

    let file: string | null = null;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      file = candidate;
    } else if (!extname(candidate)) {
      const shell = join(root, 'index.html');
      if (existsSync(shell)) file = shell;
    }
    if (!file) return next();

    const extension = extname(file);
    const immutable = file.includes('/assets/') || extension === '.woff2';

    return new Response(createReadStream(file) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  };
}
