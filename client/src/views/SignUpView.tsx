import { useState, type FormEvent, type ReactElement } from 'react';
import { store } from '../store.ts';
import { troubleMessage } from '../errors.ts';

export function SignUpView({ token }: { token: string }): ReactElement {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.signUp(token, email, name, password);
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (trouble) {
      setError(troubleMessage(trouble));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="card centring">
      <h1 className="brand">LinguTodo7</h1>
      <p className="muted">You’ve been invited. Pick a name, an email and a password.</p>

      <form onSubmit={submit} className="stack">
        <label>
          Your name
          <input
            data-testid="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
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
            autoComplete="new-password"
            data-testid="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          <span className="muted small">At least 8 characters.</span>
        </label>

        {error ? (
          <p className="error" role="alert" data-testid="error">
            {error}
          </p>
        ) : null}

        <button type="submit" className="primary" data-testid="sign-up" disabled={busy}>
          {busy ? 'Creating…' : 'Create my account'}
        </button>
      </form>
    </main>
  );
}
