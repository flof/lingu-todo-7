import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.ts';

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, expected] = parts as [string, string, string, string, string, string];
  const key = scryptSync(password, Buffer.from(salt, 'base64url'), SCRYPT.keyLength, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (expectedBuf.length !== key.length) return false;
  return timingSafeEqual(key, expectedBuf);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export type SessionMember = { id: string; name: string; email: string };

/**
 * Sessions never expire on their own: the phone stays logged in until someone
 * taps "log out". `last_seen_at` exists only for support and housekeeping.
 */
export function createSession(db: Db, memberId: string): string {
  const token = newToken();
  const now = Date.now();
  db.prepare(
    'insert into sessions (token_hash, member_id, created_at, last_seen_at) values (?, ?, ?, ?)',
  ).run(tokenHash(token), memberId, now, now);
  return token;
}

export function memberForSession(db: Db, token: string | undefined): SessionMember | null {
  if (!token) return null;
  const row = db
    .prepare(
      `select m.id as id, m.name as name, m.email as email
         from sessions s join members m on m.id = s.member_id
        where s.token_hash = ?`,
    )
    .get(tokenHash(token)) as SessionMember | undefined;
  if (!row) return null;
  db.prepare('update sessions set last_seen_at = ? where token_hash = ?').run(
    Date.now(),
    tokenHash(token),
  );
  return row;
}

export function destroySession(db: Db, token: string | undefined): void {
  if (!token) return;
  db.prepare('delete from sessions where token_hash = ?').run(tokenHash(token));
}

/** A single-use, seven-day invite — the only way an account is created. */
export function createInvite(
  db: Db,
  createdBy: string | null,
  ttlMs: number,
): { token: string; expiresAt: number } {
  const token = newToken();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  db.prepare(
    'insert into invites (token_hash, created_by, created_at, expires_at) values (?, ?, ?, ?)',
  ).run(tokenHash(token), createdBy, now, expiresAt);
  return { token, expiresAt };
}

export function inviteIsUsable(db: Db, token: string): boolean {
  const row = db
    .prepare('select used_at, expires_at from invites where token_hash = ?')
    .get(tokenHash(token)) as { used_at: number | null; expires_at: number } | undefined;
  return !!row && row.used_at === null && row.expires_at > Date.now();
}

const MAX_FAILURES = 5;
const BLOCK_MS = 60_000;

/** Cheap brute-force brake on a public endpoint. */
export function loginBlockedFor(db: Db, ip: string): number {
  const row = db
    .prepare('select blocked_until from login_attempts where ip = ?')
    .get(ip) as { blocked_until: number | null } | undefined;
  if (!row?.blocked_until || row.blocked_until <= Date.now()) return 0;
  return row.blocked_until - Date.now();
}

export function recordLoginFailure(db: Db, ip: string): void {
  const row = db
    .prepare('select failures from login_attempts where ip = ?')
    .get(ip) as { failures: number } | undefined;
  const failures = (row?.failures ?? 0) + 1;
  const blockedUntil = failures >= MAX_FAILURES ? Date.now() + BLOCK_MS : null;
  db.prepare(
    `insert into login_attempts (ip, failures, blocked_until) values (?, ?, ?)
     on conflict (ip) do update set failures = excluded.failures, blocked_until = excluded.blocked_until`,
  ).run(ip, blockedUntil === null ? failures : 0, blockedUntil);
}

export function clearLoginFailures(db: Db, ip: string): void {
  db.prepare('delete from login_attempts where ip = ?').run(ip);
}
