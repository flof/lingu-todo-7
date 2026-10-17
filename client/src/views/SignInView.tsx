import { useState, type FormEvent, type ReactElement } from 'react';
import { store } from '../store.ts';
import { troubleMessage } from '../errors.ts';

export function SignInView(): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.signIn(email, password);
    } catch (trouble) {
      setError(troubleMessage(trouble));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="card centring">
      <h1 className="brand">LinguTodo7</h1>
      <p className="muted">The household’s lists, on every phone.</p>

      <form onSubmit={submit} className="stack">
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            data-testid="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            data-testid="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error ? (
          <p className="error" role="alert" data-testid="error">
            {error}
          </p>
        ) : null}

        <button type="submit" className="primary" data-testid="sign-in" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="muted small">
        New here? Ask a family member for an invite link — accounts are only made from one of those.
      </p>
    </main>
  );
}
