/**
 * Puts a known household into a throwaway database so the browser tests can sign
 * in. Run by the Playwright webServer command, before the app starts.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/src/db.ts';
import { hashPassword } from '../server/src/auth.ts';
import { newId } from '../shared/schema.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, '.e2e');

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const db = openDb(join(dir, 'lingutodo7.sqlite'));
const now = Date.now();
const members = [
  ['mum@example.com', 'Mum'],
  ['dad@example.com', 'Dad'],
];

for (const [email, name] of members) {
  db.prepare(
    'insert into members (id, email, name, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
  ).run(newId(), email, name, hashPassword('correct horse'), now, now);
}
db.close();

console.log(`seeded ${members.length} members in ${dir}`);
