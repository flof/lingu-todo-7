import type { Op, Snapshot, SyncResponse } from '@shared/schema';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...(init.headers ?? {}) } : init.headers,
    });
  } catch {
    throw new ApiError(0, 'offline');
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? 'request-failed');
  }
  return (await response.json()) as T;
}

export const api = {
  login: (email: string, password: string): Promise<Snapshot> =>
    call('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  signUp: (token: string, email: string, name: string, password: string): Promise<Snapshot> =>
    call('/api/signup', { method: 'POST', body: JSON.stringify({ token, email, name, password }) }),

  logout: (): Promise<{ ok: true }> => call('/api/logout', { method: 'POST' }),

  snapshot: (): Promise<Snapshot> => call('/api/snapshot'),

  sync: (ops: Op[]): Promise<SyncResponse> =>
    call('/api/sync', { method: 'POST', body: JSON.stringify({ ops }) }),

  createInvite: (): Promise<{ token: string; expiresAt: number }> =>
    call('/api/invites', { method: 'POST' }),
};
