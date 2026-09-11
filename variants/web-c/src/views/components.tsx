import type { CaseStatus, RiskLevel, SignalSeverity } from '../api/types.js';
import { STATUS_LABELS } from '../lib/format.js';

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`badge badge-risk-${level}`}>{level}</span>;
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge badge-status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: SignalSeverity }) {
  return <span className={`badge badge-risk-${severity}`}>{severity}</span>;
}

export function Flag({ value }: { value: boolean }) {
  return value ? (
    <span className="flag flag-yes" aria-label="Verified">
      ✓ Yes
    </span>
  ) : (
    <span className="flag flag-no" aria-label="Not verified">
      ✕ No
    </span>
  );
}
