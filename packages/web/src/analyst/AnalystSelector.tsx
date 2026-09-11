import type { Analyst } from '../api/types';
import { DEFAULT_ANALYST_ID } from './AnalystContext';

interface AnalystSelectorProps {
  analystId: string;
  analysts: Analyst[];
  onChange: (id: string) => void;
}

export function AnalystSelector({ analystId, analysts, onChange }: AnalystSelectorProps) {
  return (
    <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      Demo identity
      <select value={analystId} onChange={(event) => onChange(event.target.value)}>
        {!analysts.some((analyst) => analyst.id === analystId) ? (
          <option value={analystId}>{analystId}</option>
        ) : null}
        {analystId !== DEFAULT_ANALYST_ID && !analysts.some((analyst) => analyst.id === DEFAULT_ANALYST_ID) ? (
          <option value={DEFAULT_ANALYST_ID}>Default demo identity ({DEFAULT_ANALYST_ID})</option>
        ) : null}
        {analysts.map((analyst) => (
          <option key={analyst.id} value={analyst.id}>
            {analyst.name} ({analyst.role})
          </option>
        ))}
      </select>
    </label>
  );
}
