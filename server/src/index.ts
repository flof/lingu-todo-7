import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { createInvite } from './auth.ts';
import { backupDb, openDb } from './db.ts';
import { listen } from './http.ts';
import { staticAssets } from './static.ts';
import { LIMITS } from '../../shared/schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const dataDir = resolve(process.env.DATA_DIR ?? join(repoRoot, 'data'));
const dbPath = process.env.DB_PATH ?? join(dataDir, 'lingutodo7.sqlite');
const backupDir = process.env.BACKUP_DIR ?? join(dataDir, 'backups');
const staticDir = process.env.STATIC_DIR ?? join(repoRoot, 'client/dist');
// Local development runs over plain http, where a Secure cookie is never sent.
const secureCookies = process.env.SECURE_COOKIES !== 'false';

const db = openDb(dbPath);
const app = createApp({ db, secureCookies });
app.use('*', staticAssets(staticDir));

listen(app, { host, port });
console.log(`LinguTodo7 listening on http://${host}:${port}`);
console.log(`database: ${dbPath}`);
console.log(`backups:  ${backupDir}`);

firstRunInvite();
scheduleNightlyBackup();

/**
 * Accounts only come from invites, so an empty household needs one to start
 * with. It is printed once, and only while there are no members at all.
 */
function firstRunInvite(): void {
  const { count } = db.prepare('select count(*) as count from members').get() as { count: number };
  if (count > 0) return;

  const { token } = createInvite(db, null, LIMITS.inviteTtlMs);
  const base = process.env.APP_URL ?? `http://localhost:${port}`;
  console.log('');
  console.log('No members yet. First invite (valid seven days, single use):');
  console.log(`  ${base.replace(/\/$/, '')}/invite/${token}`);
  console.log('');
}

/** A dump a night, seven kept — the whole database is one small file. */
function scheduleNightlyBackup(): void {
  const runAt = () => {
    try {
      const file = backupDb(db, backupDir, 7);
      if (file) console.log(`backup written: ${file}`);
    } catch (error) {
      console.error('backup failed', error);
    }
  };

  const next = new Date();
  next.setHours(3, 15, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);

  setTimeout(() => {
    runAt();
    setInterval(runAt, 24 * 60 * 60 * 1000);
  }, next.getTime() - Date.now()).unref();

  console.log(`next backup: ${next.toISOString()}`);
}
