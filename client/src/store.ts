import {
  monotonicNow,
  newId,
  type Item,
  type List,
  type Member,
  type NewOp,
  type Op,
  type OpResult,
  type Pin,
  type Snapshot,
  type SyncResponse,
} from '@shared/schema';
import { ApiError, api } from './api.ts';
import { openLocalDb, type Schema } from './localdb.ts';
import type { IDBPDatabase } from 'idb';

export type Notice = { id: string; text: string };

export type View = {
  phase: 'loading' | 'signed-out' | 'ready';
  member: Member | null;
  members: { id: string; name: string }[];
  lists: List[];
  items: Item[];
  /** List ids this member has pinned, this device included. */
  pins: string[];
  pending: number;
  syncing: boolean;
  offline: boolean;
  notices: Notice[];
};

const EMPTY: View = {
  phase: 'loading',
  member: null,
  members: [],
  lists: [],
  items: [],
  pins: [],
  pending: 0,
  syncing: false,
  offline: false,
  notices: [],
};

const REASONS: Record<string, string> = {
  'list-deleted': 'the list was deleted before it got there',
  'list-archived': 'the list is archived, so it is read-only',
  'not-creator': 'only the person who created that list can do that',
  'item-deleted': 'the item was already gone',
  'item-missing': 'the item no longer exists',
  'list-missing': 'the list no longer exists',
  invalid: 'it did not look like a valid change',
};

/** Discarded writes are always spoken out loud, never swallowed (ADR 0002). */
function noticeFor(results: OpResult[]): Notice | null {
  const discarded = results.filter((result) => result.status === 'discarded');
  if (discarded.length === 0) return null;

  const counts = new Map<string, number>();
  for (const result of discarded) {
    const reason = result.reason ?? 'invalid';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const parts = [...counts].map(([reason, count]) => {
    const what = count === 1 ? 'One change' : `${count} changes`;
    return `${what} didn’t reach the list — ${REASONS[reason] ?? 'the server refused it'}`;
  });
  return { id: newId(), text: `${parts.join('. Also, ')}.` };
}

/**
 * The single source of truth on the device: everything is written locally first,
 * queued in the outbox, and reconciled with the server when the network allows.
 */
export class Store {
  #db: IDBPDatabase<Schema> | null = null;
  #view: View = EMPTY;
  #listeners = new Set<() => void>();
  #inFlight: Promise<void> | null = null;
  #again = false;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): View => this.#view;

  async init(): Promise<void> {
    this.#db = await openLocalDb();

    const member = await this.#readMeta<Member>('member');
    if (member) {
      this.#view = {
        ...this.#view,
        phase: 'ready',
        member,
        members: (await this.#readMeta<View['members']>('members')) ?? [],
      };
      await this.#refreshFromLocal();
    } else {
      this.#view = { ...this.#view, phase: 'signed-out' };
    }
    this.#emit();

    window.addEventListener('online', () => {
      void this.sync();
    });
    window.addEventListener('offline', () => {
      this.#set({ offline: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.sync();
    });
    // Coming back to the app after the shop is the moment to catch up.
    window.addEventListener('focus', () => {
      void this.sync();
    });
    // A phone left open on the kitchen table keeps up with the others.
    setInterval(() => {
      if (!document.hidden) void this.sync();
    }, 60_000);

    await this.sync();
  }

  // -- writing --------------------------------------------------------------

  send(newOp: NewOp): Promise<void> {
    return this.#sendImpl(newOp);
  }

  async #sendImpl(newOp: NewOp): Promise<void> {
    const db = this.#db;
    if (!db) return;

    const op = { ...newOp, id: newId(), at: await this.#nextAt() } as Op;
    await db.put('outbox', op);
    await this.#applyLocally(op);
    await this.#refreshFromLocal();
    this.#set({ pending: await this.#pendingCount() });

    if (navigator.onLine !== false) void this.sync();
  }

  // -- accounts -------------------------------------------------------------

  async signIn(email: string, password: string): Promise<void> {
    const snapshot = await api.login(email, password);
    await this.#adopt(snapshot);
  }

  async signUp(token: string, email: string, name: string, password: string): Promise<void> {
    const snapshot = await api.signUp(token, email, name, password);
    await this.#adopt(snapshot);
  }

  async signOut(): Promise<void> {
    await api.logout().catch(() => undefined);
    await this.#clearLocal();
    this.#set({ ...EMPTY, phase: 'signed-out' });
  }

  createInvite(): Promise<{ token: string; expiresAt: number }> {
    return api.createInvite();
  }

  dismissNotice(id: string): void {
    this.#set({ notices: this.#view.notices.filter((notice) => notice.id !== id) });
  }

  // -- syncing --------------------------------------------------------------

  sync(): Promise<void> {
    // A write made while a sync is already running lands in the outbox after
    // that sync read it, so it would otherwise wait for the next timer. Ask for
    // one more pass instead, so the change goes up right away (and the pending
    // banner never lingers).
    if (this.#inFlight) {
      this.#again = true;
      return this.#inFlight;
    }
    this.#inFlight = this.#runSync().finally(() => {
      this.#inFlight = null;
      if (this.#again) {
        this.#again = false;
        void this.sync();
      }
    });
    return this.#inFlight;
  }

  async #runSync(): Promise<void> {
    const db = this.#db;
    if (!db) return;

    this.#set({ syncing: true });
    try {
      const queued = await this.#readOutbox();
      let response: SyncResponse;
      if (queued.length > 0) {
        response = await api.sync(queued);
        const sent = new Set(queued.map((op) => op.id));
        const transaction = db.transaction('outbox', 'readwrite');
        for (const id of sent) await transaction.store.delete(id);
        await transaction.done;

        const notice = noticeFor(response.results);
        if (notice) this.#set({ notices: [...this.#view.notices, notice] });
      } else {
        response = { results: [], snapshot: await api.snapshot() };
      }

      await this.#adopt(response.snapshot);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.#clearLocal();
        this.#set({ ...EMPTY, phase: 'signed-out' });
        return;
      }
      this.#set({ offline: true });
    } finally {
      this.#set({ syncing: false, pending: await this.#pendingCount() });
    }
  }

  /** Take the server's word for everything, then re-apply anything still queued. */
  async #adopt(snapshot: Snapshot): Promise<void> {
    const db = this.#db;
    if (!db) return;

    const transaction = db.transaction(['lists', 'items', 'pins', 'meta'], 'readwrite');
    await Promise.all([
      transaction.objectStore('lists').clear(),
      transaction.objectStore('items').clear(),
      transaction.objectStore('pins').clear(),
    ]);
    for (const list of snapshot.lists) await transaction.objectStore('lists').put(list);
    for (const item of snapshot.items) await transaction.objectStore('items').put(item);
    for (const pin of snapshot.pins) await transaction.objectStore('pins').put(pin);
    await transaction.objectStore('meta').put({ key: 'member', value: snapshot.member });
    await transaction.objectStore('meta').put({ key: 'members', value: snapshot.members });
    await transaction.done;

    await this.#replayOutbox();

    this.#view = { ...this.#view, phase: 'ready', member: snapshot.member, members: snapshot.members, offline: false };
    await this.#refreshFromLocal();
  }

  /** Writes queued while a sync was in flight belong on top of the new snapshot. */
  async #replayOutbox(): Promise<void> {
    for (const op of await this.#readOutbox()) await this.#applyLocally(op);
  }

  // -- local store helpers --------------------------------------------------

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }

  #set(patch: Partial<View>): void {
    this.#view = { ...this.#view, ...patch };
    this.#emit();
  }

  async #readMeta<T>(key: string): Promise<T | null> {
    const record = await this.#db?.get('meta', key);
    return (record?.value as T | undefined) ?? null;
  }

  async #writeMeta(key: string, value: unknown): Promise<void> {
    await this.#db?.put('meta', { key, value });
  }

  async #nextAt(): Promise<number> {
    const at = monotonicNow(await this.#readMeta<number>('clock'));
    await this.#writeMeta('clock', at);
    return at;
  }

  async #readOutbox(): Promise<Op[]> {
    const ops = (await this.#db?.getAll('outbox')) ?? [];
    return ops.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }

  async #pendingCount(): Promise<number> {
    return (await this.#db?.count('outbox')) ?? 0;
  }

  async #refreshFromLocal(): Promise<void> {
    const db = this.#db;
    if (!db) return;
    const [lists, items, pins] = await Promise.all([
      db.getAll('lists'),
      db.getAll('items'),
      db.getAll('pins'),
    ]);
    this.#set({
      lists: lists.sort((a, b) => b.createdAt - a.createdAt),
      items,
      pins: pins.map((pin: Pin) => pin.listId),
    });
  }

  async #clearLocal(): Promise<void> {
    const db = this.#db;
    if (!db) return;
    const transaction = db.transaction(['lists', 'items', 'pins', 'outbox', 'meta'], 'readwrite');
    await Promise.all([
      transaction.objectStore('lists').clear(),
      transaction.objectStore('items').clear(),
      transaction.objectStore('pins').clear(),
      transaction.objectStore('outbox').clear(),
      transaction.objectStore('meta').clear(),
    ]);
    await transaction.done;
  }

  /** The same rules the server applies, minus the permission checks (the UI
   *  never offers a write the member may not make). */
  async #applyLocally(op: Op): Promise<void> {
    const db = this.#db;
    if (!db) return;

    switch (op.kind) {
      case 'list.create': {
        const list: List = {
          id: op.list.id,
          name: op.list.name.trim(),
          emoji: op.list.emoji,
          createdBy: this.#view.member?.id ?? '',
          archived: false,
          createdAt: op.at,
          updatedAt: op.at,
        };
        await db.put('lists', list);
        return;
      }
      case 'list.rename': {
        const list = await db.get('lists', op.listId);
        if (!list || list.archived) return;
        await db.put('lists', { ...list, name: op.name.trim(), emoji: op.emoji, updatedAt: op.at });
        return;
      }
      case 'list.archive': {
        const list = await db.get('lists', op.listId);
        if (!list || list.updatedAt > op.at) return;
        await db.put('lists', { ...list, archived: op.archived, updatedAt: op.at });
        return;
      }
      case 'list.delete': {
        const list = await db.get('lists', op.listId);
        if (!list) return;
        await db.delete('lists', op.listId);
        for (const item of await db.getAllFromIndex('items', 'byList', op.listId)) {
          await db.delete('items', item.id);
        }
        await db.delete('pins', op.listId);
        return;
      }
      case 'item.create': {
        const item: Item = {
          id: op.itemId,
          listId: op.listId,
          text: op.text.trim(),
          checked: false,
          checkedAt: null,
          createdAt: op.at,
          updatedAt: op.at,
        };
        await db.put('items', item);
        return;
      }
      case 'item.setText': {
        const item = await db.get('items', op.itemId);
        if (!item || item.updatedAt > op.at) return;
        await db.put('items', { ...item, text: op.text.trim(), updatedAt: op.at });
        return;
      }
      case 'item.setChecked': {
        const item = await db.get('items', op.itemId);
        if (!item || item.updatedAt > op.at) return;
        await db.put('items', {
          ...item,
          checked: op.checked,
          checkedAt: op.checked ? op.at : null,
          updatedAt: op.at,
        });
        return;
      }
      case 'item.delete': {
        const item = await db.get('items', op.itemId);
        if (!item || item.updatedAt > op.at) return;
        await db.delete('items', op.itemId);
        return;
      }
      case 'list.clearChecked': {
        for (const item of await db.getAllFromIndex('items', 'byList', op.listId)) {
          if (item.checked && item.updatedAt <= op.at) await db.delete('items', item.id);
        }
        return;
      }
      case 'pin.set': {
        if (op.pinned) {
          await db.put('pins', { listId: op.listId, at: op.at });
        } else {
          await db.delete('pins', op.listId);
        }
        return;
      }
    }
  }
}

export const store = new Store();
