import { ApiError } from './api.ts';

/** Turns an API failure into something worth reading on a phone. */
export function troubleMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'offline') return 'No connection. This one needs to reach the server.';
    if (error.code === 'wrong-credentials') return 'That email and password don’t match.';
    if (error.code.startsWith('too-many-attempts')) {
      return 'Too many tries just now. Wait a minute and try again.';
    }
    if (error.code === 'invite-invalid') {
      return 'That invite has already been used, or it has expired.';
    }
    if (error.code === 'email-taken') return 'That email address already has an account.';
    if (error.code === 'invalid-input') return 'Please check the fields and try again.';
    return 'Something went wrong. Try again.';
  }
  return 'Something went wrong. Try again.';
}
