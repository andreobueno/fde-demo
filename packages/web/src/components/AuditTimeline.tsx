import { useEffect, useMemo, useState } from 'react';
import type { AuditEvent, RefundAuditEvent } from '../api/types';
import { verifyChain, type ChainVerification } from '../lib/auditChain';
import { formatDateTime, humanize } from '../lib/format';
import { Badge } from './Badge';
import styles from './Detail.module.css';

export function AuditTimeline({ events }: { events: (AuditEvent | RefundAuditEvent)[] }) {
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verificationError, setVerificationError] = useState(false);
  const sorted = useMemo(() => [...events].sort((a, b) => b.sequence - a.sequence), [events]);

  useEffect(() => {
    let cancelled = false;
    setVerification(null);
    setVerificationError(false);
    verifyChain(events).then((result) => {
      if (!cancelled) setVerification(result);
    }).catch(() => {
      if (!cancelled) setVerificationError(true);
    });
    return () => { cancelled = true; };
  }, [events]);

  return (
    <section className={styles.section}>
      <h2>Audit trail</h2>
      <div className={styles.chain}>
        {verificationError ? (
          <span>Verification unavailable in this browser.</span>
        ) : verification === null ? (
          <span>Verifying…</span>
        ) : verification.ok ? (
          <span className={styles.chainOk}>Chain verified ({events.length} events)</span>
        ) : (
          <span className={styles.chainBad}>Chain broken at #{verification.brokenAtSequence}</span>
        )}
      </div>
      {sorted.map((event) => (
        <div key={event.id} className={styles.event}>
          <div className={styles.eventHead}>
            <span className={styles.eventActor}>{event.actorName}</span>
            <span>{humanize(event.action)}</span>
            <Badge kind="status" value={event.fromStatus ?? '—'} />
            <span>→</span>
            <Badge kind="status" value={event.toStatus ?? '—'} />
            <span className={styles.eventTime}>{formatDateTime(event.createdAt)}</span>
          </div>
          {event.note ? <div className={styles.eventNote}>{event.note}</div> : null}
          <div className={styles.eventHash}>
            hash <span className="mono" title={event.hash}>{event.hash.slice(0, 12)}…</span>
          </div>
        </div>
      ))}
    </section>
  );
}
