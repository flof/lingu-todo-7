import {
  LIMITS,
  validateEmoji,
  validateItemText,
  validateListName,
  type Item,
  type List,
  type Op,
  type OpResult,
  type Pin,
  type Snapshot,
} from '../../shared/schema.ts';
import type { Db } from './db.ts';

/**
 * Applies a client's queued writes (ADR 0002).
 *
 * Every op carries the moment the member acted (`at`). An op wins only if it is
 * newer than the row it touches, so replaying the same batch is harmless and two
 * phones editing the same item resolve to whoever acted last. Ops that cannot be
 * applied at all — a list renamed by someone who is not its creator, an item
 * added to a list that is archived or gone — are reported as discarded so the
 * client can tell the member rather than silently swallow the change.
 */

type ListRow = {
  id: string;
  name: string;
  emoji: string;
  created_by: string;
  archived: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

type ItemRow = {
  id: string;
  list_id: string;
  text: string;
  checked: number;
  checked_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

const toList = (row: ListRow): List => ({
  id: row.id,
  name: row.name,
  emoji: row.emoji,
  createdBy: row.created_by,
  archived: row.archived === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toItem = (row: ItemRow): Item => ({
  id: row.id,
  listId: row.list_id,
  text: row.text,
  checked: row.checked === 1,
  checkedAt: row.checked_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const ok = (opId: string): OpResult => ({ opId, status: 'ok' });
const stale = (opId: string): OpResult => ({ opId, status: 'stale', reason: 'newer-change-won' });
const discarded = (opId: string, reason: string): OpResult => ({ opId, status: 'discarded', reason });

export function applyOps(db: Db, memberId: string, ops: Op[]): OpResult[] {
  const ordered = [...ops].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  db.exec('begin');
  try {
    const results = ordered.map((op) => applyOp(db, memberId, op));
    db.exec('commit');
    return results;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}

function applyOp(db: Db, memberId: string, op: Op): OpResult {
  if (typeof op?.id !== 'string' || typeof op?.at !== 'number' || !Number.isFinite(op.at)) {
    return discarded(String(op?.id ?? 'unknown'), 'invalid');
  }

  switch (op.kind) {
    case 'list.create':
      return applyListCreate(db, memberId, op);
    case 'list.rename':
      return applyListRename(db, memberId, op);
    case 'list.archive':
      return applyListArchive(db, memberId, op);
    case 'list.delete':
      return applyListDelete(db, memberId, op);
    case 'item.create':
      return applyItemCreate(db, memberId, op);
    case 'item.setText':
      return applyItemText(db, memberId, op);
    case 'item.setChecked':
      return applyItemChecked(db, memberId, op);
    case 'item.delete':
      return applyItemDelete(db, memberId, op);
    case 'list.clearChecked':
      return applyClearChecked(db, memberId, op);
    case 'pin.set':
      return applyPinSet(db, memberId, op);
    default:
      return discarded((op as { id: string }).id, 'invalid');
  }
}

function loadList(db: Db, listId: string): ListRow | undefined {
  return db.prepare('select * from lists where id = ?').get(listId) as ListRow | undefined;
}

function loadItem(db: Db, itemId: string): ItemRow | undefined {
  return db.prepare('select * from items where id = ?').get(itemId) as ItemRow | undefined;
}

/**
 * A list that may be written to at all: it exists, is not deleted, and is not
 * archived (archived lists are read-only — see GLOSSARY.md).
 */
function writableList(
  db: Db,
  listId: string,
): { list: ListRow } | { fails: (opId: string) => OpResult } {
  const list = loadList(db, listId);
  if (!list) return { fails: (opId) => discarded(opId, 'list-missing') };
  if (list.deleted_at !== null) return { fails: (opId) => discarded(opId, 'list-deleted') };
  if (list.archived === 1) return { fails: (opId) => discarded(opId, 'list-archived') };
  return { list };
}

function applyListCreate(db: Db, memberId: string, op: Extract<Op, { kind: 'list.create' }>): OpResult {
  const name = validateListName(op.list?.name);
  if (!name || typeof op.list?.id !== 'string') return discarded(op.id, 'invalid');
  const existing = loadList(db, op.list.id);
  if (existing) return existing.deleted_at === null ? ok(op.id) : discarded(op.id, 'list-deleted');

  db.prepare(
    `insert into lists (id, name, emoji, created_by, archived, created_at, updated_at, deleted_at)
     values (?, ?, ?, ?, 0, ?, ?, null)`,
  ).run(op.list.id, name, validateEmoji(op.list.emoji), memberId, op.at, op.at);
  return ok(op.id);
}

function creatorWritable(
  db: Db,
  memberId: string,
  listId: string,
): { list: ListRow } | { fails: (opId: string) => OpResult } {
  const found = writableList(db, listId);
  if ('fails' in found) return found;
  if (found.list.created_by !== memberId) {
    return { fails: (opId) => discarded(opId, 'not-creator') };
  }
  return found;
}

function applyListRename(db: Db, memberId: string, op: Extract<Op, { kind: 'list.rename' }>): OpResult {
  const name = validateListName(op.name);
  if (!name) return discarded(op.id, 'invalid');
  const found = creatorWritable(db, memberId, op.listId);
  if ('fails' in found) return found.fails(op.id);
  if (op.at <= found.list.updated_at) return stale(op.id);

  db.prepare('update lists set name = ?, emoji = ?, updated_at = ? where id = ?').run(
    name,
    validateEmoji(op.emoji),
    op.at,
    op.listId,
  );
  return ok(op.id);
}

function applyListArchive(
  db: Db,
  memberId: string,
  op: Extract<Op, { kind: 'list.archive' }>,
): OpResult {
  const list = loadList(db, op.listId);
  if (!list) return discarded(op.id, 'list-missing');
  if (list.deleted_at !== null) return discarded(op.id, 'list-deleted');
  if (list.created_by !== memberId) return discarded(op.id, 'not-creator');
  if (op.at <= list.updated_at) return stale(op.id);

  db.prepare('update lists set archived = ?, updated_at = ? where id = ?').run(
    op.archived ? 1 : 0,
    op.at,
    op.listId,
  );
  return ok(op.id);
}

function applyListDelete(db: Db, memberId: string, op: Extract<Op, { kind: 'list.delete' }>): OpResult {
  const list = loadList(db, op.listId);
  if (!list) return discarded(op.id, 'list-missing');
  if (list.deleted_at !== null) return ok(op.id);
  if (list.created_by !== memberId) return discarded(op.id, 'not-creator');
  if (op.at <= list.updated_at) return stale(op.id);

  db.prepare('update lists set deleted_at = ?, updated_at = ? where id = ?').run(
    op.at,
    op.at,
    op.listId,
  );
  db.prepare(
    'update items set deleted_at = ?, updated_at = ? where list_id = ? and deleted_at is null',
  ).run(op.at, op.at, op.listId);
  return ok(op.id);
}

function applyItemCreate(
  db: Db,
  memberId: string,
  op: Extract<Op, { kind: 'item.create' }>,
): OpResult {
  const text = validateItemText(op.text);
  if (!text || typeof op.itemId !== 'string') return discarded(op.id, 'invalid');
  const found = writableList(db, op.listId);
  if ('fails' in found) return found.fails(op.id);

  const existing = loadItem(db, op.itemId);
  if (existing) return existing.deleted_at === null ? ok(op.id) : discarded(op.id, 'item-deleted');

  db.prepare(
    `insert into items (id, list_id, text, checked, checked_at, created_at, updated_at, deleted_at)
     values (?, ?, ?, 0, null, ?, ?, null)`,
  ).run(op.itemId, op.listId, text, op.at, op.at);
  return ok(op.id);
}

/** Guards shared by the ops that touch an existing item. */
function editableItem(
  db: Db,
  opId: string,
  itemId: string,
): { item: ItemRow; list: ListRow } | { result: OpResult } {
  const item = loadItem(db, itemId);
  if (!item) return { result: discarded(opId, 'item-missing') };
  if (item.deleted_at !== null) return { result: discarded(opId, 'item-deleted') };
  const found = writableList(db, item.list_id);
  if ('fails' in found) return { result: found.fails(opId) };
  return { item, list: found.list };
}

function applyItemText(db: Db, memberId: string, op: Extract<Op, { kind: 'item.setText' }>): OpResult {
  const text = validateItemText(op.text);
  if (!text) return discarded(op.id, 'invalid');
  const guarded = editableItem(db, op.id, op.itemId);
  if ('result' in guarded) return guarded.result;
  if (op.at <= guarded.item.updated_at) return stale(op.id);

  db.prepare('update items set text = ?, updated_at = ? where id = ?').run(text, op.at, op.itemId);
  return ok(op.id);
}

function applyItemChecked(
  db: Db,
  memberId: string,
  op: Extract<Op, { kind: 'item.setChecked' }>,
): OpResult {
  const guarded = editableItem(db, op.id, op.itemId);
  if ('result' in guarded) return guarded.result;
  if (op.at <= guarded.item.updated_at) return stale(op.id);
  if ((guarded.item.checked === 1) === op.checked) return ok(op.id);

  db.prepare('update items set checked = ?, checked_at = ?, updated_at = ? where id = ?').run(
    op.checked ? 1 : 0,
    op.checked ? op.at : null,
    op.at,
    op.itemId,
  );
  return ok(op.id);
}

function applyItemDelete(
  db: Db,
  memberId: string,
  op: Extract<Op, { kind: 'item.delete' }>,
): OpResult {
  const guarded = editableItem(db, op.id, op.itemId);
  if ('result' in guarded) return guarded.result;
  if (op.at <= guarded.item.updated_at) return stale(op.id);

  db.prepare('update items set deleted_at = ?, updated_at = ? where id = ?').run(
    op.at,
    op.at,
    op.itemId,
  );
  return ok(op.id);
}

function applyClearChecked(
  db: Db,
  memberId: string,
  op: Extract<Op, { kind: 'list.clearChecked' }>,
): OpResult {
  const found = writableList(db, op.listId);
  if ('fails' in found) return found.fails(op.id);

  db.prepare(
    `update items set deleted_at = ?, updated_at = ?
      where list_id = ? and checked = 1 and deleted_at is null and updated_at <= ?`,
  ).run(op.at, op.at, op.listId, op.at);
  return ok(op.id);
}

function applyPinSet(db: Db, memberId: string, op: Extract<Op, { kind: 'pin.set' }>): OpResult {
  const list = loadList(db, op.listId);
  if (!list) return discarded(op.id, 'list-missing');
  if (list.deleted_at !== null) return discarded(op.id, 'list-deleted');

  const existing = db
    .prepare('select * from pins where member_id = ? and list_id = ?')
    .get(memberId, op.listId) as
    | { pinned_at: number; updated_at: number; deleted_at: number | null }
    | undefined;

  if (existing && existing.updated_at > op.at) return stale(op.id);

  const repinning = op.pinned && (existing === undefined || existing.deleted_at !== null);
  const pinnedAt = repinning ? op.at : (existing?.pinned_at ?? op.at);

  db.prepare(
    `insert into pins (member_id, list_id, pinned_at, updated_at, deleted_at)
     values (?, ?, ?, ?, ?)
     on conflict (member_id, list_id) do update set
       pinned_at = excluded.pinned_at,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
  ).run(memberId, op.listId, pinnedAt, op.at, op.pinned ? null : op.at);
  return ok(op.id);
}

export function snapshotFor(db: Db, memberId: string): Snapshot {
  const memberRow = db
    .prepare('select id, email, name, created_at from members where id = ?')
    .get(memberId) as { id: string; email: string; name: string; created_at: number };

  const lists = (db
    .prepare('select * from lists where deleted_at is null order by created_at desc')
    .all() as unknown as ListRow[]).map(toList);

  const items = (db
    .prepare('select * from items where deleted_at is null order by created_at desc')
    .all() as unknown as ItemRow[]).map(toItem);

  const pins = (db
    .prepare(
      `select p.list_id as listId, p.pinned_at as at
         from pins p join lists l on l.id = p.list_id
        where p.member_id = ? and p.deleted_at is null and l.deleted_at is null`,
    )
    .all(memberId) as unknown as Pin[]).map((pin) => ({ listId: pin.listId, at: pin.at }));

  const members = db
    .prepare('select id, name from members order by created_at')
    .all() as unknown as { id: string; name: string }[];

  return {
    member: {
      id: memberRow.id,
      email: memberRow.email,
      name: memberRow.name,
      createdAt: memberRow.created_at,
    },
    members,
    lists,
    items,
    pins,
    serverTime: Date.now(),
  };
}

export { LIMITS };
