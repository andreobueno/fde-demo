import { humanize } from '../lib/format';
import styles from './Badge.module.css';

interface BadgeProps {
  kind: 'risk' | 'status' | 'severity';
  value: string;
}

export function Badge({ kind, value }: BadgeProps) {
  const cls = styles[value] ?? '';
  void kind;
  return <span className={`${styles.badge} ${cls}`}>{humanize(value)}</span>;
}
