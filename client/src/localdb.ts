import type { Item, List, Op, Pin } from '@shared/schema';

export type MetaRecord = { key: string; value: unknown };

/**
 * The device's own copy of everything, plus the outbox of writes that have not
 * reached the server yet (ADR 0002). Grows no bigger than a family's lists.
 */
export interface Schema {
  lists: { key: string; value: List };
  items: { key: string; value: Item; indexes: { byList: string } };
  pins: { key: string; value: Pin };
  outbox: { key: string; value: Op; indexes: { byAt: number } };
  meta: { key: string; value: MetaRecord };
}

export function openLocalDb(): Promise<import('idb').IDBPDatabase<Schema>> {
  return import('idb').then(({ openDB }) =>
    openDB<Schema>('lingutodo7', 1, {
      upgrade(db) {
        db.createObjectStore('lists', { keyPath: 'id' });
        const items = db.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('byList', 'listId');
        db.createObjectStore('pins', { keyPath: 'listId' });
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        outbox.createIndex('byAt', 'at');
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    }),
  );
}
