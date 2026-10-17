import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = DatabaseSync;

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = WAL');
  db.exec('pragma foreign_keys = ON');
  db.exec('pragma busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Applies every migration file that has not been applied yet, in name order. */
export function migrate(db: Db): void {
  db.exec(
    'create table if not exists migrations (id text primary key, applied_at integer not null)',
  );
  const applied = new Set(
    (db.prepare('select id from migrations').all() as { id: string }[]).map((row) => row.id),
  );
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec('begin');
    try {
      db.exec(sql);
      db.prepare('insert into migrations (id, applied_at) values (?, ?)').run(file, Date.now());
      db.exec('commit');
    } catch (error) {
      db.exec('rollback');
      throw new Error(`migration ${file} failed: ${String(error)}`);
    }
  }
}

/** Nightly dumps land here; the directory is a mounted host volume. */
export function backupDb(db: Db, dir: string, keep = 7): string | null {
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const target = join(dir, `lingutodo7-${stamp}.sqlite`);

  // "vacuum into" refuses to overwrite, so yesterday's file of the same name goes.
  if (existsSync(target)) unlinkSync(target);
  const escaped = target.replace(/'/g, "''");
  db.exec(`vacuum into '${escaped}'`);

  const files = readdirSync(dir)
    .filter((file) => /^lingutodo7-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file))
    .sort();
  for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      unlinkSync(join(dir, stale));
    } catch {
      /* a failed prune must not fail the backup */
    }
  }
  return target;
}
