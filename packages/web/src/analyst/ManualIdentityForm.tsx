import { useEffect, useRef, useState } from 'react';
import { ApiError, authenticateAccessToken } from '../api/client';

export function ManualIdentityForm() {
  const [token, setToken] = useState('');
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
      await authenticateAccessToken(token, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError && err.status === 401
          ? 'Invalid or expired access token. Ask an administrator for a new token.'
          : err instanceof Error ? err.message : 'Unexpected error. Please try again.');
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setToken('');
        setSubmitting(false);
      }
    }
  };

  return (
    <section style={{ maxWidth: 640, margin: '48px auto', padding: 24 }} aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Sign in to Operations</h1>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} style={{ marginTop: 8 }}>
        <p>Enter the access token provided by your administrator. Your role is verified by the server.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="access-token">Access token</label>
          <input
            id="access-token"
            type="password"
            value={token}
            onChange={(event) => { setToken(event.target.value); setError(null); }}
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            maxLength={128}
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
      <p>Credentials stay in memory. Refreshing the page or switching users requires signing in again.</p>
    </section>
  );
}
