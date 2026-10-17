/**
 * The domain vocabulary shared by server and client: the shapes that move over
 * the wire, the write operations, and the amount rule from ADR 0001.
 *
 * Both sides import this; nothing here may depend on the DOM or on node.
 */

export const LIMITS = {
  listName: 60,
  itemText: 200,
  emoji: 8,
  memberName: 40,
  email: 254,
  passwordMin: 8,
  /** How long a checked item stays in place before it sinks (ms). */
  sinkDelayMs: 5000,
  /** Invites expire after this long. */
  inviteTtlMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export type Member = {
  id: string;
  email: string;
  name: string;
  createdAt: number;
};

export type List = {
  id: string;
  name: string;
  emoji: string;
  createdBy: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Item = {
  id: string;
  listId: string;
  text: string;
  checked: boolean;
  checkedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Pin = {
  listId: string;
  at: number;
};

export type Snapshot = {
  member: Member;
  members: Pick<Member, 'id' | 'name'>[];
  lists: List[];
  items: Item[];
  pins: Pin[];
  serverTime: number;
};

export type Op =
  | { id: string; at: number; kind: 'list.create'; list: { id: string; name: string; emoji: string } }
  | { id: string; at: number; kind: 'list.rename'; listId: string; name: string; emoji: string }
  | { id: string; at: number; kind: 'list.archive'; listId: string; archived: boolean }
  | { id: string; at: number; kind: 'list.delete'; listId: string }
  | { id: string; at: number; kind: 'item.create'; listId: string; itemId: string; text: string }
  | { id: string; at: number; kind: 'item.setText'; itemId: string; text: string }
  | { id: string; at: number; kind: 'item.setChecked'; itemId: string; checked: boolean }
  | { id: string; at: number; kind: 'item.delete'; itemId: string }
  | { id: string; at: number; kind: 'list.clearChecked'; listId: string }
  | { id: string; at: number; kind: 'pin.set'; listId: string; pinned: boolean };

export type OpResult = {
  opId: string;
  status: 'ok' | 'stale' | 'discarded';
  reason?: string;
};

/** Distributes over the Op union, so each variant keeps its own fields. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** An op as a caller describes it, before the device stamps it with id and time. */
export type NewOp = DistributiveOmit<Op, 'id' | 'at'>;

export type SyncResponse = {
  results: OpResult[];
  snapshot: Snapshot;
};

// ---------------------------------------------------------------------------
// Amount: a leading number in the item text (ADR 0001)
// ---------------------------------------------------------------------------

const LEADING_AMOUNT = /^(\d+)(?:[ \u00a0]+)?/;

/** The amount an item's text declares, or null when it declares none. */
export function readAmount(text: string): number | null {
  const match = LEADING_AMOUNT.exec(text);
  return match ? Number(match[1]) : null;
}

/** The item text without its leading amount. */
export function readLabel(text: string): string {
  return text.replace(LEADING_AMOUNT, '');
}

/**
 * Apply a tap on an item's +/− button. An item with no number counts as one, so
 * the first tap of + turns "butter" into "2 butter"; tapping − back down through
 * "1 butter" removes the number entirely. Only the digits change, so the rest of
 * the line is left exactly as the member typed it.
 */
export function bumpAmount(text: string, delta: 1 | -1): string {
  const match = LEADING_AMOUNT.exec(text);
  if (!match) return delta === 1 ? `2 ${text}`.trimEnd() : text;

  const digits = match[1] as string;
  const next = Number(digits) + delta;
  if (next <= 0) return text.slice(match[0].length);
  return `${next}${text.slice(digits.length)}`;
}

// ---------------------------------------------------------------------------
// Ids and clocks
// ---------------------------------------------------------------------------

export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const CLOCK_KEY = 'lingutodo7.clock';

/**
 * Timestamps drive last-write-wins, so they must never go backwards on a
 * device — not even when the system clock does.
 */
export function monotonicNow(lastSeen: number | null, wallClock = Date.now()): number {
  if (lastSeen === null || wallClock > lastSeen) return wallClock;
  return lastSeen + 1;
}

export { CLOCK_KEY };

// ---------------------------------------------------------------------------
// Ordering (a list view only)
// ---------------------------------------------------------------------------

export function displayOrder<T extends { checked: boolean; createdAt: number; checkedAt: number | null }>(
  items: T[],
  stillInPlace: ReadonlySet<string> | null,
  idOf: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const aSunk = a.checked && !(stillInPlace?.has(idOf(a)) ?? false);
    const bSunk = b.checked && !(stillInPlace?.has(idOf(b)) ?? false);
    if (aSunk !== bSunk) return aSunk ? 1 : -1;
    if (!aSunk) return b.createdAt - a.createdAt;
    return (b.checkedAt ?? 0) - (a.checkedAt ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  if (trimmed.length > LIMITS.email || !EMAIL.test(trimmed)) return null;
  return trimmed;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < LIMITS.passwordMin) return null;
  if (password.length > 200) return null;
  return password;
}

export function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > LIMITS.memberName) return null;
  return trimmed;
}

export function validateListName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > LIMITS.listName) return null;
  return trimmed;
}

export function validateItemText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0 || trimmed.length > LIMITS.itemText) return null;
  return trimmed;
}

export function validateEmoji(emoji: unknown): string {
  if (typeof emoji !== 'string') return '';
  return [...emoji.trim()].slice(0, 4).join('').slice(0, LIMITS.emoji);
}
