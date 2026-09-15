import { useEffect, useRef, useState } from 'react';
import { ApiError, signIn } from '../api/client';

export function ManualIdentityForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  const submit = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError && err.status === 401
          ? 'Incorrect email or password.'
          : err instanceof Error ? err.message : 'Unexpected error. Please try again.');
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setPassword('');
        setSubmitting(false);
      }
    }
  };

  return (
    <section style={{ maxWidth: 640, margin: '48px auto', padding: 24 }} aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Sign in to Operations</h1>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} style={{ marginTop: 8 }}>
        <p>Sign in with your email and password. Your permissions are verified by the server.</p>
        <div style={{ display: 'grid', gap: 12 }}>
          <label htmlFor="sign-in-email">Email</label>
          <input
            id="sign-in-email"
            type="email"
            value={email}
            onChange={(event) => { setEmail(event.target.value); setError(null); }}
            autoComplete="username"
            disabled={submitting}
            maxLength={254}
            required
          />
          <label htmlFor="sign-in-password">Password</label>
          <input
            id="sign-in-password"
            type="password"
            value={password}
            onChange={(event) => { setPassword(event.target.value); setError(null); }}
            autoComplete="current-password"
            spellCheck={false}
            disabled={submitting}
            maxLength={256}
            required
            aria-invalid={error !== null}
            aria-describedby={error ? 'manual-analyst-error' : undefined}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        {error ? (
          <p id="manual-analyst-error" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>
        ) : null}
      </form>
      {import.meta.env.DEV ? (
        <aside aria-label="Local demo accounts" style={{ marginTop: 24 }}>
          <h2>Local demo accounts</h2>
          <p>All use password <code>demo-password-2026</code>. Fictional accounts for local evaluation only.</p>
          <ul>
            <li>Analyst: <code>grete.lindholm@northwind-demo.example</code></li>
            <li>Senior analyst: <code>marta.ellison@northwind-demo.example</code></li>
            <li>Compliance manager: <code>sofia.chen@northwind-demo.example</code></li>
          </ul>
        </aside>
      ) : null}
      <p>This tab keeps its own session across refreshes. Open another local port in a new tab to sign in as a different user.</p>
    </section>
  );
}
