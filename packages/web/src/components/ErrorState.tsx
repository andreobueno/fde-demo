import { ApiError } from '../api/client';

interface ErrorStateProps {
  error: ApiError;
  onRetry?: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const message =
    error.status === 0
      ? 'Cannot reach the API server. Is `npm run dev:server` running on port 4000?'
      : error.message;
  return (
    <div role="alert" style={{ padding: '24px', textAlign: 'center' }}>
      <p>{message}</p>
      {onRetry ? <button onClick={onRetry}>Retry</button> : null}
    </div>
  );
}
