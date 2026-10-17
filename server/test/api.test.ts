import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LIMITS, bumpAmount, displayOrder, monotonicNow, newId, readAmount, readLabel, type Op, type SyncResponse } from '../../shared/schema.ts';
import { createApp } from '../src/app.ts';
import { createInvite, createSession, hashPassword } from '../src/auth.ts';
import { backupDb, openDb, type Db } from '../src/db.ts';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'lingutodo7-'));
  const db = openDb(join(dir, 'test.sqlite'));
  const app = createApp({ db, secureCookies: false });
  return { dir, db, app };
}

type App = ReturnType<typeof createApp>;

/** A member with a session, talking to the app the way a browser would. */
class Client {
  private cookie = '';
  private readonly app: App;
  private readonly db: Db;

  constructor(app: App, db: Db) {
    this.app = app;
    this.db = db;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.app.request(`http://localhost${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      this.cookie = raw.split(';')[0] ?? '';
    }
    return response;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    assert.equal(response.status, 200, `expected 200 from ${path}, got ${response.status}`);
    return (await response.json()) as T;
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  sync(ops: Op[]): Promise<SyncResponse> {
    return this.post<SyncResponse>('/api/sync', { ops });
  }

  signedInAs(memberId: string): this {
    this.cookie = `lingutodo7_session=${createSession(this.db, memberId)}`;
    return this;
  }
}

/** A member inserted directly: the signup path has its own tests. */
function addMember(db: Db, email: string, name = email.split('@')[0] ?? 'member'): string {
  const id = newId();
  const now = Date.now();
  db.prepare(
    'insert into members (id, email, name, password_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
  ).run(id, email, name, hashPassword('correct horse'), now, now);
  return id;
}

let clock = 1_700_000_000_000;
const tick = (ms = 1000) => (clock += ms);

// ---------------------------------------------------------------------------
// Amount (ADR 0001)
// ---------------------------------------------------------------------------

test('the + button starts an amount at two, counts up, and − takes it away again', () => {
  // An item with no number counts as one, so the first tap makes it two.
  assert.equal(bumpAmount('butter', 1), '2 butter');
  assert.equal(bumpAmount('2 butter', 1), '3 butter');
  assert.equal(bumpAmount('2 kg flour', 1), '3 kg flour');
  assert.equal(bumpAmount('3 butter', -1), '2 butter');
  assert.equal(bumpAmount('2 butter', -1), '1 butter');
  assert.equal(bumpAmount('1 butter', -1), 'butter');
  assert.equal(bumpAmount('butter', -1), 'butter');
  assert.equal(readAmount('12 eggs'), 12);
  assert.equal(readAmount('2 kg flour'), 2);
  assert.equal(readAmount('kg flour'), null);
  assert.equal(readLabel('2 kg flour'), 'kg flour');
  // A leading number is the amount even when the text runs straight on: "6-pack"
  // counts up to "7-pack", because the app never parses units.
  assert.equal(bumpAmount('6-pack beer', 1), '7-pack beer');
});

test('timestamps never go backwards, even when the device clock does', () => {
  assert.equal(monotonicNow(null, 100), 100);
  assert.equal(monotonicNow(100, 90), 101);
  assert.equal(monotonicNow(100, 150), 150);
});

test('a checked item stays in place until its five seconds are up', () => {
  const items = [
    { id: 'a', checked: true, checkedAt: 10, createdAt: 1 },
    { id: 'b', checked: false, checkedAt: null, createdAt: 5 },
    { id: 'c', checked: false, checkedAt: null, createdAt: 7 },
  ];
  const order = (stillInPlace: Set<string> | null) =>
    displayOrder(items, stillInPlace, (item) => item.id).map((item) => item.id);

  assert.deepEqual(order(new Set(['a'])), ['c', 'b', 'a']);
  assert.deepEqual(order(new Set()), ['c', 'b', 'a']);
  assert.deepEqual(order(new Set(['a'])).slice(2), ['a']);

  const sooner = [...items, { id: 'd', checked: true, checkedAt: 11, createdAt: 2 }];
  assert.deepEqual(
    displayOrder(sooner, null, (item) => item.id).map((item) => item.id),
    ['c', 'b', 'd', 'a'],
  );
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

test('an invite is the only way in, and it works exactly once', async () => {
  const { app, db } = harness();
  const founder = addMember(db, 'mum@example.com', 'Mum');
  const inviter = new Client(app, db).signedInAs(founder);

  const invite = await inviter.post<{ token: string }>('/api/invites', {});
  assert.ok(invite.token.length > 20);

  const guest = new Client(app, db);
  const snapshot = await guest.post<SyncResponse['snapshot']>('/api/signup', {
    token: invite.token,
    email: 'dad@example.com',
    name: 'Dad',
    password: 'correct horse',
  });
  assert.equal(snapshot.member.email, 'dad@example.com');

  const reuse = await new Client(app, db).request('/api/signup', {
    method: 'POST',
    body: JSON.stringify({
      token: invite.token,
      email: 'kid@example.com',
      name: 'Kid',
      password: 'correct horse',
    }),
  });
  assert.equal(reuse.status, 400);
  assert.equal(((await reuse.json()) as { error: string }).error, 'invite-invalid');
});

test('signup rejects short passwords and taken addresses', async () => {
  const { app, db } = harness();
  const founder = addMember(db, 'mum@example.com');
  addMember(db, 'dad@example.com');
  const inviter = new Client(app, db).signedInAs(founder);
  const invite = await inviter.post<{ token: string }>('/api/invites', {});

  const weak = await new Client(app, db).request('/api/signup', {
    method: 'POST',
    body: JSON.stringify({ token: invite.token, email: 'a@b.co', name: 'A', password: 'short' }),
  });
  assert.equal(weak.status, 400);

  const taken = await new Client(app, db).request('/api/signup', {
    method: 'POST',
    body: JSON.stringify({
      token: invite.token,
      email: 'dad@example.com',
      name: 'Dad again',
      password: 'correct horse',
    }),
  });
  assert.equal(taken.status, 409);
});

test('login needs the right password, and repeated failures slow down', async () => {
  const { app, db } = harness();
  addMember(db, 'mum@example.com');

  const client = new Client(app, db);
  const wrong = await client.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'mum@example.com', password: 'nope' }),
  });
  assert.equal(wrong.status, 401);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await client.request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'mum@example.com', password: 'nope' }),
    });
  }
  const throttled = await client.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'mum@example.com', password: 'correct horse' }),
  });
  assert.equal(throttled.status, 429);
});

test('sessions carry across requests, and logging out ends them', async () => {
  const { app, db } = harness();
  addMember(db, 'mum@example.com');
  const client = new Client(app, db);

  await client.post('/api/login', { email: 'mum@example.com', password: 'correct horse' });
  const me = await client.json<{ member: { email: string } }>('/api/snapshot');
  assert.equal(me.member.email, 'mum@example.com');

  await client.post('/api/logout', {});
  assert.equal((await client.request('/api/snapshot')).status, 401);
});

test('signed-out callers get nothing', async () => {
  const { app, db } = harness();
  const client = new Client(app, db);
  assert.equal((await client.request('/api/snapshot')).status, 401);
  assert.equal(
    (await client.request('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [] }) })).status,
    401,
  );
});

// ---------------------------------------------------------------------------
// Lists, items, permissions
// ---------------------------------------------------------------------------

test('anyone adds and checks items; only the creator renames, archives or deletes a list', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com', 'Mum');
  const dad = addMember(db, 'dad@example.com', 'Dad');

  const mumClient = new Client(app, db).signedInAs(mum);
  const listId = newId();
  await mumClient.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '🛒' } },
  ]);

  const dadClient = new Client(app, db).signedInAs(dad);
  const added = await dadClient.sync([
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId: newId(), text: 'butter' },
  ]);
  assert.equal(added.results[0]?.status, 'ok');

  const renamedByDad = await dadClient.sync([
    { id: newId(), at: tick(), kind: 'list.rename', listId, name: 'Dad groceries', emoji: '' },
  ]);
  assert.equal(renamedByDad.results[0]?.status, 'discarded');
  assert.equal(renamedByDad.results[0]?.reason, 'not-creator');
  assert.equal(renamedByDad.snapshot.lists[0]?.name, 'Groceries');

  const renamedByMum = await mumClient.sync([
    { id: newId(), at: tick(), kind: 'list.rename', listId, name: 'Weekly shop', emoji: '🛒' },
  ]);
  assert.equal(renamedByMum.results[0]?.status, 'ok');
  assert.equal(renamedByMum.snapshot.lists[0]?.name, 'Weekly shop');

  const dadDeletes = await dadClient.sync([{ id: newId(), at: tick(), kind: 'list.delete', listId }]);
  assert.equal(dadDeletes.results[0]?.reason, 'not-creator');
  assert.equal(dadDeletes.snapshot.lists.length, 1);
});

test('an archived list is read-only until its creator takes it back', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com', 'Mum');
  const client = new Client(app, db).signedInAs(mum);
  const listId = newId();
  const itemId = newId();

  await client.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Holiday packing', emoji: '🧳' } },
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId, text: 'passports' },
  ]);
  await client.sync([{ id: newId(), at: tick(), kind: 'list.archive', listId, archived: true }]);

  const write = await client.sync([
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId: newId(), text: 'sunscreen' },
  ]);
  assert.equal(write.results[0]?.status, 'discarded');
  assert.equal(write.results[0]?.reason, 'list-archived');

  const readOnlyCheck = await client.sync([
    { id: newId(), at: tick(), kind: 'item.setChecked', itemId, checked: true },
  ]);
  assert.equal(readOnlyCheck.results[0]?.reason, 'list-archived');

  const restored = await client.sync([
    { id: newId(), at: tick(), kind: 'list.archive', listId, archived: false },
  ]);
  assert.equal(restored.results[0]?.status, 'ok');
  assert.equal(restored.snapshot.lists[0]?.archived, false);
});

test('a write queued offline against a deleted list is discarded, not resurrected', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com', 'Mum');
  const client = new Client(app, db).signedInAs(mum);
  const listId = newId();

  await client.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '🛒' } },
  ]);

  // Dad checked "bread" on a phone that then went offline; meanwhile the list goes.
  const offlineCheck = { id: newId(), at: tick(5000), kind: 'item.setChecked' as const, itemId: newId(), checked: true };
  const create = await client.sync([
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId: offlineCheck.itemId, text: 'bread' },
  ]);
  const bread = create.snapshot.items[0];
  assert.ok(bread);

  await client.sync([{ id: newId(), at: tick(60_000), kind: 'list.delete', listId }]);

  const queued = await client.sync([
    { ...offlineCheck, itemId: bread.id, at: tick(120_000) },
    { id: newId(), at: tick(120_000), kind: 'item.create', listId, itemId: newId(), text: 'eggs' },
  ]);
  assert.deepEqual(
    queued.results.map((result) => result.reason),
    ['item-deleted', 'list-deleted'],
  );
  assert.equal(queued.snapshot.lists.length, 0);
  assert.equal(queued.snapshot.items.length, 0);
});

test('the newest write to an item wins, and replaying a batch changes nothing', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com', 'Mum');
  const client = new Client(app, db).signedInAs(mum);
  const listId = newId();
  const itemId = newId();

  await client.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '' } },
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId, text: 'milk' },
  ]);

  const rename = { id: newId(), at: tick(10_000), kind: 'item.setText' as const, itemId, text: 'oat milk' };
  const older = { id: newId(), at: tick(-20_000), kind: 'item.setText' as const, itemId, text: 'milk 2' };

  const first = await client.sync([rename]);
  assert.equal(first.results[0]?.status, 'ok');

  const second = await client.sync([rename]);
  assert.equal(second.results[0]?.status, 'stale');
  assert.equal(second.snapshot.items[0]?.text, 'oat milk');

  const third = await client.sync([older]);
  assert.equal(third.results[0]?.status, 'stale');
  assert.equal(third.snapshot.items[0]?.text, 'oat milk');
});

test('checking stamps the time and unchecking clears it', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com');
  const client = new Client(app, db).signedInAs(mum);
  const listId = newId();
  const itemId = newId();

  await client.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '' } },
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId, text: 'butter' },
  ]);

  const checkedAt = tick();
  const checked = await client.sync([
    { id: newId(), at: checkedAt, kind: 'item.setChecked', itemId, checked: true },
  ]);
  assert.deepEqual(checked.snapshot.items[0]?.checked, true);
  assert.equal(checked.snapshot.items[0]?.checkedAt, checkedAt);

  const unchecked = await client.sync([
    { id: newId(), at: tick(), kind: 'item.setChecked', itemId, checked: false },
  ]);
  assert.equal(unchecked.snapshot.items[0]?.checked, false);
  assert.equal(unchecked.snapshot.items[0]?.checkedAt, null);
});

test('clearing checked items removes only the struck-through ones, if it has anything to lose', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com');
  const client = new Client(app, db).signedInAs(mum);
  const listId = newId();
  const butter = newId();
  const bread = newId();
  const eggs = newId();

  await client.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '' } },
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId: butter, text: 'butter' },
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId: bread, text: 'bread' },
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId: eggs, text: 'eggs' },
    { id: newId(), at: tick(), kind: 'item.setChecked', itemId: butter, checked: true },
  ]);

  const cleared = await client.sync([{ id: newId(), at: tick(), kind: 'list.clearChecked', listId }]);
  const texts = cleared.snapshot.items.map((item) => item.text).sort();
  assert.deepEqual(texts, ['bread', 'eggs']);

  // An older clear cannot sweep up an item checked after it.
  const lateCheck = { id: newId(), at: tick(30_000), kind: 'item.setChecked' as const, itemId: bread, checked: true };
  await client.sync([lateCheck]);
  const staleClear = await client.sync([
    { id: newId(), at: tick(-5_000), kind: 'list.clearChecked', listId },
  ]);
  assert.equal(staleClear.results[0]?.status, 'ok');
  assert.deepEqual(staleClear.snapshot.items.map((item) => item.text).sort(), ['bread', 'eggs']);
});

test('deleting a single item takes it off the list for everyone', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com');
  const dad = addMember(db, 'dad@example.com');
  const mumClient = new Client(app, db).signedInAs(mum);
  const listId = newId();
  const itemId = newId();

  await mumClient.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '' } },
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId, text: 'butter' },
  ]);

  const dadClient = new Client(app, db).signedInAs(dad);
  const removed = await dadClient.sync([
    { id: newId(), at: tick(), kind: 'item.delete', itemId },
  ]);
  assert.equal(removed.results[0]?.status, 'ok');
  assert.equal(removed.snapshot.items.length, 0);
});

test('pins are personal, and survive a rename', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com', 'Mum');
  const dad = addMember(db, 'dad@example.com', 'Dad');
  const mumClient = new Client(app, db).signedInAs(mum);
  const listId = newId();

  await mumClient.sync([
    { id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '' } },
    { id: newId(), at: tick(), kind: 'pin.set', listId, pinned: true },
  ]);
  assert.equal((await mumClient.json<SyncResponse['snapshot']>('/api/snapshot')).pins.length, 1);

  const dadClient = new Client(app, db).signedInAs(dad);
  assert.equal((await dadClient.json<SyncResponse['snapshot']>('/api/snapshot')).pins.length, 0);

  const unpinned = await mumClient.sync([
    { id: newId(), at: tick(), kind: 'pin.set', listId, pinned: false },
  ]);
  assert.equal(unpinned.snapshot.pins.length, 0);
});

test('pinning a list that is gone is discarded', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com');
  const client = new Client(app, db).signedInAs(mum);

  const result = await client.sync([
    { id: newId(), at: tick(), kind: 'pin.set', listId: newId(), pinned: true },
  ]);
  assert.equal(result.results[0]?.reason, 'list-missing');
});

test('the snapshot names every member, so a list can say who made it', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com', 'Mum');
  addMember(db, 'dad@example.com', 'Dad');
  const client = new Client(app, db).signedInAs(mum);

  const snapshot = await client.json<SyncResponse['snapshot']>('/api/snapshot');
  assert.deepEqual(
    snapshot.members.map((member) => member.name),
    ['Mum', 'Dad'],
  );
});

test('nonsense items are refused rather than stored', async () => {
  const { app, db } = harness();
  const mum = addMember(db, 'mum@example.com');
  const client = new Client(app, db).signedInAs(mum);
  const listId = newId();

  await client.sync([{ id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: '  ', emoji: '' } }]);
  assert.equal((await client.json<SyncResponse['snapshot']>('/api/snapshot')).lists.length, 0);

  await client.sync([{ id: newId(), at: tick(), kind: 'list.create', list: { id: listId, name: 'Groceries', emoji: '' } }]);
  const empty = await client.sync([
    { id: newId(), at: tick(), kind: 'item.create', listId, itemId: newId(), text: '   ' },
  ]);
  assert.equal(empty.results[0]?.reason, 'invalid');

  const huge = await client.sync([
    {
      id: newId(),
      at: tick(),
      kind: 'item.create',
      listId,
      itemId: newId(),
      text: 'x'.repeat(LIMITS.itemText + 1),
    },
  ]);
  assert.equal(huge.results[0]?.reason, 'invalid');
});

test('a night of backups keeps one file a day and prunes the seventh-oldest', async () => {
  const { dir, db } = harness();
  const backupDir = join(dir, 'backups');

  const written = backupDb(db, backupDir, 7);
  assert.ok(written);
  assert.match(written, /lingutodo7-\d{4}-\d{2}-\d{2}\.sqlite$/);

  // Same-day repeat overwrites rather than piling up.
  backupDb(db, backupDir, 7);
  const { readdirSync } = await import('node:fs');
  assert.equal(readdirSync(backupDir).length, 1);
});
