import type { Analyst } from '../api/types';

interface AnalystSelectorProps {
  analyst: Analyst;
  onSignOut: () => void;
}

export function AnalystSelector({ analyst, onSignOut }: AnalystSelectorProps) {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <span>Signed in as {analyst.name} ({analyst.role})</span>
      <button type="button" onClick={onSignOut}>Sign out / switch user</button>
    </div>
  );
}
