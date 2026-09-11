import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCase, getRiskExplanation, postCaseAction } from '../api/client';
import { useApi } from '../api/useApi';
import { useAnalyst } from '../analyst/AnalystContext';
import type {
  AuditEvent,
  CaseAction,
  CaseDetail,
  Customer,
  RiskExplanation,
} from '../api/types';
import { ActionDialog } from '../components/ActionDialog';
import { Badge } from '../components/Badge';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { Toast } from '../components/Toast';
import { ACTION_LABELS } from '../lib/actionRules';
import { verifyChain, type ChainVerification } from '../lib/auditChain';
import { formatDate, formatDateTime, formatUsd, humanize } from '../lib/format';
import styles from './CasePage.module.css';

const ACTION_BUTTON_CLASS: Record<CaseAction, string> = {
  approve: 'primary',
  reject: 'danger',
  escalate: 'warn',
  start_review: '',
};

export function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { analystId, analysts } = useAnalyst();
  const [openAction, setOpenAction] = useState<CaseAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const caseResult = useApi(
    (signal) => getCase(id ?? '', analystId, signal),
    [id, analystId],
  );
  const riskResult = useApi(
    (signal) => getRiskExplanation(id ?? '', analystId, signal),
    [id, analystId],
  );

  if (caseResult.error) {
    if (caseResult.error.status === 404) {
      return (
        <div className={styles.page}>
          <h1>Case not found</h1>
          <p>
            <Link to="/">Back to queue</Link>
          </p>
        </div>
      );
    }
    return (
      <div className={styles.page}>
        <ErrorState error={caseResult.error} onRetry={caseResult.reload} />
      </div>
    );
  }

  if (!caseResult.data) {
    return (
      <div className={styles.page}>
        <Loading />
      </div>
    );
  }

  const kase = caseResult.data;

  const handleSubmitAction = async (note: string) => {
    if (!openAction || !id) {
      return;
    }
    await postCaseAction(id, openAction, note, analystId);
    setToast(`Case ${kase.reference}: ${ACTION_LABELS[openAction]} succeeded`);
    setOpenAction(null);
    caseResult.reload();
    riskResult.reload();
  };

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.back}>
        ← Back to queue
      </Link>
      <div className={styles.header}>
        <h1>{kase.reference}</h1>
        <Badge kind="status" value={kase.status} />
        <Badge kind="risk" value={kase.riskLevel} />
        <span>Score {kase.riskScore}</span>
        <div className={styles.headerMeta}>
          Assigned to{' '}
          {kase.assignedTo
            ? analysts.find((a) => a.id === kase.assignedTo)?.name ?? kase.assignedTo
            : '—'}{' '}
          · Created {formatDateTime(kase.createdAt)} ·
          Updated {formatDateTime(kase.updatedAt)}
        </div>
      </div>

      <CustomerSection customer={kase.customer} />
      <SignalsSection kase={kase} />
      {riskResult.data ? (
        <RiskPanel explanation={riskResult.data} />
      ) : riskResult.error ? (
        <ErrorState error={riskResult.error} onRetry={riskResult.reload} />
      ) : (
        <Loading />
      )}

      <section className={styles.section}>
        <h2>Actions</h2>
        {kase.allowedActions.length === 0 ? (
          <p className={styles.closed}>Case closed — no further actions available.</p>
        ) : (
          <div className={styles.actions}>
            {kase.allowedActions.map((action) => (
              <button
                key={action}
                type="button"
                className={ACTION_BUTTON_CLASS[action]}
                onClick={() => setOpenAction(action)}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        )}
      </section>

      <AuditTimeline events={kase.audit} />

      {openAction ? (
        <ActionDialog
          action={openAction}
          riskLevel={kase.riskLevel}
          caseReference={kase.reference}
          onClose={() => setOpenAction(null)}
          onSubmit={handleSubmitAction}
        />
      ) : null}
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function CustomerSection({ customer }: { customer: Customer }) {
  const verified = (ok: boolean) =>
    ok ? <span className={styles.ok}>✓ Verified</span> : <span className={styles.bad}>✗ Not verified</span>;
  const flag = (b: boolean) =>
    b ? <span className={styles.bad}>Yes</span> : <span>No</span>;

  const rows: Array<[string, JSX.Element | string | number]> = [
    ['Full name', customer.fullName],
    ['Date of birth', formatDate(customer.dateOfBirth)],
    ['Nationality', customer.nationality],
    ['Country of residence', customer.countryOfResidence],
    ['Occupation', humanize(customer.occupation)],
    ['Email', customer.email],
    ['Account opened', formatDateTime(customer.accountOpenedAt)],
    ['Expected monthly volume', formatUsd(customer.expectedMonthlyVolumeUsd)],
    ['Source of funds', humanize(customer.sourceOfFunds)],
    ['ID document type', humanize(customer.idDocumentType)],
    [
      'ID document expires',
      customer.idDocumentExpiresAt ? formatDate(customer.idDocumentExpiresAt) : '—',
    ],
    ['ID document verified', verified(customer.idDocumentVerified)],
    ['Address verified', verified(customer.addressVerified)],
    ['PEP flag', flag(customer.pepFlag)],
    ['Sanctions hit', flag(customer.sanctionsHit)],
    ['Adverse media hits', customer.adverseMediaHits],
    ['Customer ID', customer.id],
  ];

  return (
    <section className={styles.section}>
      <h2>Customer information</h2>
      <dl className={styles.defList}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SignalsSection({ kase }: { kase: CaseDetail }) {
  return (
    <section className={styles.section}>
      <h2>Risk signals</h2>
      {kase.signals.length === 0 ? (
        <p className={styles.closed}>No risk signals.</p>
      ) : (
        <div>
          {kase.signals.map((s) => (
            <div key={s.id} className={styles.signal}>
              <Badge kind="severity" value={s.severity} />
              <div className={styles.signalBody}>
                <div className={styles.signalTitle}>{s.title}</div>
                <div className={styles.signalDesc}>{s.description}</div>
              </div>
              <div className={styles.signalWeight}>+{s.weight}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RiskPanel({ explanation }: { explanation: RiskExplanation }) {
  const factors = useMemo(
    () => [...explanation.factors].sort((a, b) => b.weight - a.weight),
    [explanation.factors],
  );
  const title =
    explanation.riskLevel === 'high' ? 'Why is this case high risk?' : 'Risk assessment';
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      <p>{explanation.summary}</p>
      <div className={styles.meterWrap}>
        <div className={styles.meter}>
          <div
            className={`${styles.meterFill} ${styles[explanation.riskLevel] ?? ''}`}
            style={{ width: `${Math.min(100, Math.max(0, explanation.riskScore))}%` }}
          />
          <div
            className={styles.marker}
            style={{ left: `${explanation.thresholds.medium}%` }}
          />
          <div className={styles.marker} style={{ left: `${explanation.thresholds.high}%` }} />
          <div
            className={styles.markerLabel}
            style={{ left: `${explanation.thresholds.medium}%` }}
          >
            medium ≥{explanation.thresholds.medium}
          </div>
          <div
            className={styles.markerLabel}
            style={{ left: `${explanation.thresholds.high}%` }}
          >
            high ≥{explanation.thresholds.high}
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Factor</th>
            <th>Description</th>
            <th>Weight</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((f) => (
            <tr key={f.code}>
              <td>
                <Badge kind="severity" value={f.severity} />
              </td>
              <td>{f.title}</td>
              <td>{f.description}</td>
              <td>+{f.weight}</td>
              <td>
                <span
                  className={styles.factorBar}
                  style={{ width: `${Math.max(2, f.contributionPct)}px` }}
                />{' '}
                {f.contributionPct}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const sorted = useMemo(() => [...events].sort((a, b) => b.sequence - a.sequence), [events]);

  useEffect(() => {
    let cancelled = false;
    verifyChain(events).then((result) => {
      if (!cancelled) {
        setVerification(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [events]);

  return (
    <section className={styles.section}>
      <h2>Audit trail</h2>
      <div className={styles.chain}>
        {verification === null ? (
          <span>Verifying…</span>
        ) : verification.ok ? (
          <span className={styles.chainOk}>✓ Chain verified ({events.length} events)</span>
        ) : (
          <span className={styles.chainBad}>✗ Chain broken at #{verification.brokenAtSequence}</span>
        )}
      </div>
      <div>
        {sorted.map((e) => (
          <div key={e.id} className={styles.event}>
            <div className={styles.eventHead}>
              <span className={styles.eventActor}>{e.actorName}</span>
              <span>{humanize(e.action)}</span>
              <Badge kind="status" value={e.fromStatus ?? '—'} />
              <span>→</span>
              <Badge kind="status" value={e.toStatus ?? '—'} />
              <span className={styles.eventTime}>{formatDateTime(e.createdAt)}</span>
            </div>
            {e.note ? <div className={styles.eventNote}>{e.note}</div> : null}
            <div className={styles.eventHash}>
              hash <span className="mono" title={e.hash}>{e.hash.slice(0, 12)}…</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
