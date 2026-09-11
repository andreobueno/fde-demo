import { useEffect, useRef, useState } from 'react';
import { ApiError, getMe } from '../api/client';

interface ManualIdentityFormProps {
  identitySignal: AbortSignal;
  onSelect: (id: string) => void;
}

export async function selectKnownAnalyst(
  input: string,
  signal: AbortSignal,
  onSelect: (id: string) => void,
): Promise<void> {
  const id = input.trim();
  if (!id) {
    throw new Error('Enter a known demo identity ID.');
  }
  const analyst = await getMe(id, signal);
  signal.throwIfAborted();
  onSelect(analyst.id);
}

export function ManualIdentityForm({ identitySignal, onSelect }: ManualIdentityFormProps) {
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = () => request.current?.abort();
    identitySignal.addEventListener('abort', abort);
    return () => {
      identitySignal.removeEventListener('abort', abort);
      abort();
    };
  }, [identitySignal]);

  const submit = async () => {
    if (identitySignal.aborted || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSubmitting(true);
    setError(null);
    try {
      await selectKnownAnalyst(id, controller.signal, onSelect);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError && err.status === 401
          ? 'Unknown demo identity. Ask an administrator for a valid ID.'
          : err instanceof Error ? err.message : 'Unexpected error. Please try again.');
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  };

  return (
    <details>
      <summary>Enter a known demo identity</summary>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} style={{ marginTop: 8 }}>
        <p>Use an existing identity ID provided by your administrator.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="manual-analyst-id">Demo identity ID</label>
          <input
            id="manual-analyst-id"
            type="text"
            value={id}
            onChange={(event) => { setId(event.target.value); setError(null); }}
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            required
            aria-invalid={error !== null}
            aria-describedby={error ? 'manual-analyst-error' : undefined}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Checking…' : 'Use identity'}
          </button>
        </div>
        {error ? (
          <p id="manual-analyst-error" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>
        ) : null}
      </form>
    </details>
  );
}
