import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { serialize } from 'hono/utils/cookie';
import { createInvite, createSession, destroySession, hashPassword, inviteIsUsable, loginBlockedFor, memberForSession, clearLoginFailures, recordLoginFailure, verifyPassword } from './auth.ts';
import type { Db } from './db.ts';
import { applyOps, snapshotFor } from './sync.ts';
import {
  LIMITS,
  newId,
  validateEmail,
  validateName,
  validatePassword,
  type Op,
} from '../../shared/schema.ts';

export const SESSION_COOKIE = 'lingutodo7_session';
const MAX_OPS_PER_SYNC = 2000;

export type AppOptions = {
  db: Db;
  /** Cookies are only marked Secure when the app is behind HTTPS. */
  secureCookies?: boolean;
};

export function createApp({ db, secureCookies = true }: AppOptions) {
  const app = new Hono();

  const clientIp = (headers: Headers): string =>
    headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    });

  const fail = (status: number, error: string) => json({ error }, status);

  const authenticated = (c: Context) => memberForSession(db, getCookie(c, SESSION_COOKIE));

  /**
   * The session cookie is set as a plain response header rather than through
   * Hono's context, because these handlers build their own Response objects.
   */
  const sessionCookie = (memberId: string, c: Context): string => {
    const token = createSession(db, memberId);
    const overHttps = (c.req.raw.headers.get('x-forwarded-proto') ?? '').split(',')[0] === 'https';
    return serialize(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: secureCookies && overHttps,
      path: '/',
      // The longest a browser will honour; sessions have no server-side expiry,
      // so in practice a member stays signed in until they tap "log out".
      maxAge: 400 * 24 * 60 * 60,
    });
  };

  const clearedSessionCookie = (): string =>
    serialize(SESSION_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'Lax' });

  app.get('/api/health', () => json({ ok: true }));

  app.get('/api/snapshot', (c) => {
    const member = authenticated(c);
    if (!member) return fail(401, 'not-signed-in');
    return json(snapshotFor(db, member.id));
  });

  app.post('/api/sync', async (c) => {
    const member = authenticated(c);
    if (!member) return fail(401, 'not-signed-in');

    let body: { ops?: unknown };
    try {
      body = (await c.req.json()) as { ops?: unknown };
    } catch {
      return fail(400, 'bad-json');
    }
    const ops = Array.isArray(body.ops) ? (body.ops as Op[]) : [];
    if (ops.length > MAX_OPS_PER_SYNC) return fail(400, 'too-many-ops');

    const results = applyOps(db, member.id, ops);
    return json({ results, snapshot: snapshotFor(db, member.id) });
  });

  app.post('/api/login', async (c) => {
    const ip = clientIp(c.req.raw.headers);
    const blockedFor = loginBlockedFor(db, ip);
    if (blockedFor > 0) {
      return fail(429, `too-many-attempts:${Math.ceil(blockedFor / 1000)}`);
    }

    const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
    const email = validateEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : null;
    if (!email || !password) return fail(400, 'invalid-input');

    const row = db
      .prepare('select id, password_hash from members where email = ?')
      .get(email) as { id: string; password_hash: string } | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      recordLoginFailure(db, ip);
      return fail(401, 'wrong-credentials');
    }

    clearLoginFailures(db, ip);
    return json(snapshotFor(db, row.id), 200, { 'set-cookie': sessionCookie(row.id, c) });
  });

  app.post('/api/logout', (c) => {
    destroySession(db, getCookie(c, SESSION_COOKIE));
    return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie() });
  });

  /**
   * Accounts are only ever created through an invite: there is no SMTP here, so
   * a member hands the link to the next person directly.
   */
  app.post('/api/signup', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      token?: unknown;
      email?: unknown;
      name?: unknown;
      password?: unknown;
    };
    const token = typeof body.token === 'string' ? body.token : '';
    const email = validateEmail(body.email);
    const name = validateName(body.name);
    const password = validatePassword(body.password);
    if (!email || !name || !password) return fail(400, 'invalid-input');
    if (!inviteIsUsable(db, token)) return fail(400, 'invite-invalid');

    const taken = db
      .prepare('select id from members where email = ?')
      .get(email) as { id: string } | undefined;
    if (taken) return fail(409, 'email-taken');

    const now = Date.now();
    const memberId = newId();
    db.exec('begin');
    try {
      db.prepare(
        'insert into members (id, email, name, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      ).run(memberId, email, name, hashPassword(password), now, now);
      const consumed = db
        .prepare('update invites set used_at = ?, used_by = ? where used_by is null and used_at is null and expires_at > ?')
        .run(now, memberId, now);
      if (consumed.changes === 0) throw new Error('invite-consumed');
      // The first-run invite has served its purpose the moment there is a member.
      db.prepare('delete from invites where created_by is null and used_at is null').run();
      db.exec('commit');
    } catch (error) {
      db.exec('rollback');
      return fail(400, 'invite-invalid');
    }

    return json(snapshotFor(db, memberId), 200, { 'set-cookie': sessionCookie(memberId, c) });
  });

  /** Any member may invite the next one; the link is the only credential. */
  app.post('/api/invites', (c) => {
    const member = authenticated(c);
    if (!member) return fail(401, 'not-signed-in');
    const { token, expiresAt } = createInvite(db, member.id, LIMITS.inviteTtlMs);
    return json({ token, expiresAt });
  });

  return app;
}
