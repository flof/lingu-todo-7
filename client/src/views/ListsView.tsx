import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { newId, type List } from '@shared/schema';
import { store } from '../store.ts';
import { navigate } from '../router.ts';
import { useStore } from '../useStore.ts';
import { EmojiPicker } from './EmojiPicker.tsx';

export function ListsView(): ReactElement {
  const view = useStore();
  const [showArchived, setShowArchived] = useState(false);
  const [invite, setInvite] = useState<{ link: string; expiresAt: number } | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🛒');

  const openCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of view.items) {
      if (!item.checked) counts.set(item.listId, (counts.get(item.listId) ?? 0) + 1);
    }
    return counts;
  }, [view.items]);

  const open = view.lists.filter((list) => !list.archived);
  const pinned = open.filter((list) => view.pins.includes(list.id));
  const rest = open.filter((list) => !view.pins.includes(list.id));
  const archived = view.lists.filter((list) => list.archived);

  const createList = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = newId();
    await store.send({ kind: 'list.create', list: { id, name, emoji: newEmoji } });
    setNewName('');
    navigate(`/list/${id}`);
  };

  const makeInvite = async (): Promise<void> => {
    try {
      const { token, expiresAt } = await store.createInvite();
      setInvite({ link: `${window.location.origin}/invite/${token}`, expiresAt });
    } catch {
      setInvite(null);
    }
  };

  const row = (list: List): ReactElement => (
    <li key={list.id} className="row" data-testid="list-row">
      <button
        type="button"
        className="pin"
        data-testid="pin-toggle"
        aria-pressed={view.pins.includes(list.id)}
        title={view.pins.includes(list.id) ? 'Unpin from the top' : 'Pin to the top'}
        onClick={() =>
          void store.send({
            kind: 'pin.set',
            listId: list.id,
            pinned: !view.pins.includes(list.id),
          })
        }
      >
        {view.pins.includes(list.id) ? '★' : '☆'}
      </button>
      <button type="button" className="list-open" onClick={() => navigate(`/list/${list.id}`)}>
        <span className="list-emoji" aria-hidden="true">
          {list.emoji || '📋'}
        </span>
        <span className="list-name">{list.name}</span>
        <span className="muted small">{openCounts.get(list.id) ?? 0} open</span>
      </button>
    </li>
  );

  return (
    <main className="pad">
      <header className="topbar">
        <h1 data-testid="page-title">Lists</h1>
        <div className="topbar-actions">
          <button type="button" className="bare" onClick={() => void makeInvite()} data-testid="invite-button">
            Invite
          </button>
          <button type="button" className="bare" onClick={() => void store.signOut()} data-testid="sign-out">
            Sign out
          </button>
        </div>
      </header>

      <p className="muted small">
        Signed in as {view.member?.name}
        {view.offline ? ' · offline' : ''}
      </p>

      {invite ? (
        <section className="card">
          <h2>Invite a family member</h2>
          <p className="muted small">
            Send them this link — it works once, until{' '}
            {new Date(invite.expiresAt).toLocaleDateString()}.
          </p>
          <input readOnly value={invite.link} data-testid="invite-link" onFocus={(event) => event.target.select()} />
          <div className="inline-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void navigator.clipboard?.writeText(invite.link)}
            >
              Copy link
            </button>
            <button type="button" className="bare" onClick={() => setInvite(null)}>
              Done
            </button>
          </div>
        </section>
      ) : null}

      <form className="card" onSubmit={createList}>
        <h2>New list</h2>
        <input
          placeholder="Groceries, Holiday packing…"
          value={newName}
          data-testid="new-list-name"
          onChange={(event) => setNewName(event.target.value)}
          maxLength={60}
        />
        <EmojiPicker value={newEmoji} onChange={setNewEmoji} label="Icon for the new list" />
        <button type="submit" className="primary" data-testid="create-list" disabled={!newName.trim()}>
          Create list
        </button>
      </form>

      {pinned.length > 0 ? (
        <section>
          <h2 className="section-title">Pinned</h2>
          <ul className="rows">{pinned.map(row)}</ul>
        </section>
      ) : null}

      <section>
        <h2 className="section-title">All lists</h2>
        {rest.length === 0 && pinned.length === 0 ? (
          <p className="muted">No lists yet. Make the first one above.</p>
        ) : (
          <ul className="rows">{rest.map(row)}</ul>
        )}
      </section>

      {archived.length > 0 ? (
        <section>
          <button
            type="button"
            className="bare"
            onClick={() => setShowArchived((shown) => !shown)}
            data-testid="toggle-archived"
          >
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived ? <ul className="rows archived">{archived.map(row)}</ul> : null}
        </section>
      ) : null}
    </main>
  );
}
