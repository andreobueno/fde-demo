import { useEffect, useRef, useState } from 'react';
import { ApiError, signInDemoUser } from '../api/client';
import { DEMO_USERS } from '../api/demoUsers';

export function ManualIdentityForm() {
  const [userId, setUserId] = useState('analyst');
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
      await signInDemoUser(userId, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError && err.status === 401
          ? 'The mock user could not be verified.'
          : err instanceof Error ? err.message : 'Unexpected error. Please try again.');
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setSubmitting(false);
      }
    }
  };

  if (!import.meta.env.DEV) {
    return (
      <section style={{ maxWidth: 640, margin: '48px auto', padding: 24 }}>
        <h1>Sign in to Operations</h1>
        <p>Local mock-user sign-in is unavailable in this build. Configure production SSO/OIDC.</p>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 640, margin: '48px auto', padding: 24 }} aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Choose a demo role</h1>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} style={{ marginTop: 8 }}>
        <p>Pick a fictional user. The server verifies the account and loads its current role and permissions.</p>
        <div style={{ display: 'grid', gap: 12 }}>
          <label htmlFor="demo-user">Mock user</label>
          <select
            id="demo-user"
            value={userId}
            onChange={(event) => { setUserId(event.target.value); setError(null); }}
            disabled={submitting}
            required
            aria-invalid={error !== null}
            aria-describedby={error ? 'manual-analyst-error' : undefined}
          >
            {DEMO_USERS.map((user) => (
              <option key={user.id} value={user.id}>
                {user.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </div>
        {error ? (
          <p id="manual-analyst-error" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>
        ) : null}
      </form>
      <p>This tab keeps its own session across refreshes. Open another local port in a new tab to sign in as a different user.</p>
    </section>
  );
}
