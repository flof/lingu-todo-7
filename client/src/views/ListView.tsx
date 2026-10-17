import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { LIMITS, bumpAmount, displayOrder, newId, type Item } from '@shared/schema';
import { navigate } from '../router.ts';
import { store } from '../store.ts';
import { useStore } from '../useStore.ts';
import { EmojiPicker } from './EmojiPicker.tsx';

/** Items checked on this device stay put until their five seconds are up. */
function useStillInPlace(): { ids: Set<string>; mark: (id: string) => void } {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, number>());

  const mark = useCallback((id: string) => {
    setIds((previous) => new Set(previous).add(id));
    const running = timers.current.get(id);
    if (running !== undefined) window.clearTimeout(running);
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        setIds((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }, LIMITS.sinkDelayMs),
    );
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
    },
    [],
  );

  return { ids, mark };
}

export function ListView({ listId }: { listId: string }): ReactElement {
  const view = useStore();
  const list = view.lists.find((candidate) => candidate.id === listId);
  const stillInPlace = useStillInPlace();

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [renaming, setRenaming] = useState<{ name: string; emoji: string } | null>(null);

  if (!list) {
    return (
      <main className="pad">
        <p className="muted">That list doesn’t exist any more.</p>
        <button type="button" className="primary" onClick={() => navigate('/')}>
          Back to lists
        </button>
      </main>
    );
  }

  const readOnly = list.archived;
  const isCreator = view.member?.id === list.createdBy;
  const items = view.items.filter((item) => item.listId === list.id);
  const ordered = displayOrder(items, stillInPlace.ids, (item) => item.id);
  const checkedCount = items.filter((item) => item.checked).length;

  const addItem = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    await store.send({ kind: 'item.create', listId: list.id, itemId: newId(), text });
    setDraft('');
  };

  const rewrite = (item: Item, text: string): Promise<void> => {
    if (text.trim().length === 0) return Promise.resolve();
    return store.send({ kind: 'item.setText', itemId: item.id, text });
  };

  const toggle = (item: Item): void => {
    if (!item.checked) stillInPlace.mark(item.id);
    void store.send({ kind: 'item.setChecked', itemId: item.id, checked: !item.checked });
  };

  const remove = (item: Item): void => {
    if (window.confirm(`Delete “${item.text}”?`)) {
      void store.send({ kind: 'item.delete', itemId: item.id });
    }
  };

  const clearChecked = (): void => {
    if (window.confirm(`Remove ${checkedCount} checked ${checkedCount === 1 ? 'item' : 'items'}?`)) {
      void store.send({ kind: 'list.clearChecked', listId: list.id });
    }
  };

  const row = (item: Item): ReactElement => (
    <li
      key={item.id}
      className={item.checked ? 'item checked' : 'item'}
      data-testid="item-row"
      data-checked={item.checked ? 'true' : 'false'}
      data-text={item.text}
    >
      <button
        type="button"
        className="check"
        data-testid="item-check"
        aria-pressed={item.checked}
        aria-label={item.checked ? `Uncheck ${item.text}` : `Check ${item.text}`}
        disabled={readOnly}
        onClick={() => toggle(item)}
      >
        {item.checked ? '✓' : ''}
      </button>

      {editing?.id === item.id && !readOnly ? (
        <input
          className="item-input"
          data-testid="item-input"
          autoFocus
          value={editing.text}
          maxLength={LIMITS.itemText}
          onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
          onBlur={() => {
            void rewrite(item, editing.text);
            setEditing(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void rewrite(item, editing.text);
              setEditing(null);
            }
            if (event.key === 'Escape') setEditing(null);
          }}
        />
      ) : readOnly ? (
        <span className="item-text">{item.text}</span>
      ) : (
        <button
          type="button"
          className="item-text"
          data-testid="item-text"
          onClick={() => setEditing({ id: item.id, text: item.text })}
        >
          {item.text}
        </button>
      )}

      {!readOnly ? (
        <span className="item-controls">
          <button type="button" className="step" data-testid="item-minus" onClick={() => void rewrite(item, bumpAmount(item.text, -1))}>
            −
          </button>
          <button type="button" className="step" data-testid="item-plus" onClick={() => void rewrite(item, bumpAmount(item.text, 1))}>
            +
          </button>
          <button type="button" className="danger" data-testid="item-delete" onClick={() => remove(item)}>
            ✕
          </button>
        </span>
      ) : null}
    </li>
  );

  return (
    <main className="pad">
      <header className="topbar">
        <button type="button" className="bare" onClick={() => navigate('/')} data-testid="back-to-lists">
          ‹ Lists
        </button>
        <h1>
          <span aria-hidden="true">{list.emoji || '📋'}</span> {list.name}
        </h1>
      </header>

      {readOnly ? (
        <div className="banner banner-archived" data-testid="archived-banner">
          <span>This list is archived, so it’s read-only.</span>
          {isCreator ? (
            <button
              type="button"
              className="bare"
              data-testid="unarchive"
              onClick={() => void store.send({ kind: 'list.archive', listId: list.id, archived: false })}
            >
              Take it back
            </button>
          ) : null}
        </div>
      ) : null}

      {isCreator ? (
        renaming ? (
          <form
            className="card"
            onSubmit={(event) => {
              event.preventDefault();
              void store.send({
                kind: 'list.rename',
                listId: list.id,
                name: renaming.name,
                emoji: renaming.emoji,
              });
              setRenaming(null);
            }}
          >
            <label>
              List name
              <input
                data-testid="rename-input"
                autoFocus
                value={renaming.name}
                maxLength={60}
                onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
              />
            </label>
            <EmojiPicker value={renaming.emoji} onChange={(emoji) => setRenaming({ ...renaming, emoji })} />
            <div className="inline-actions">
              <button type="submit" className="primary" data-testid="rename-save">
                Save
              </button>
              <button type="button" className="bare" onClick={() => setRenaming(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="inline-actions list-admin">
            <button
              type="button"
              className="bare"
              data-testid="rename-list"
              onClick={() => setRenaming({ name: list.name, emoji: list.emoji })}
            >
              Rename
            </button>
            <button
              type="button"
              className="bare"
              data-testid="archive-list"
              onClick={() => void store.send({ kind: 'list.archive', listId: list.id, archived: true })}
            >
              Archive
            </button>
            <button
              type="button"
              className="bare danger"
              data-testid="delete-list"
              onClick={() => {
                if (window.confirm(`Delete “${list.name}” and everything on it?`)) {
                  void store.send({ kind: 'list.delete', listId: list.id }).then(() => navigate('/'));
                }
              }}
            >
              Delete
            </button>
          </div>
        )
      ) : null}

      {!readOnly ? (
        <form className="add-item" onSubmit={addItem}>
          <input
            placeholder="Add an item…"
            data-testid="add-item-input"
            value={draft}
            maxLength={LIMITS.itemText}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="primary" data-testid="add-item" disabled={!draft.trim()}>
            Add
          </button>
        </form>
      ) : null}

      {ordered.length === 0 ? (
        <p className="muted">Nothing on this list yet.</p>
      ) : (
        <ul className="items" data-testid="item-list">
          {ordered.map(row)}
        </ul>
      )}

      {!readOnly && checkedCount > 0 ? (
        <button type="button" className="bare clear" data-testid="clear-checked" onClick={clearChecked}>
          Clear checked ({checkedCount})
        </button>
      ) : null}

      <p className="muted small">
        Started by {view.members.find((member) => member.id === list.createdBy)?.name ?? 'someone'}
      </p>
    </main>
  );
}
