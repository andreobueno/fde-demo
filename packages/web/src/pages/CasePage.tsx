import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getCase, getRiskExplanation, postCaseAction } from '../api/client';
import { useApi } from '../api/useApi';
import { useAnalyst } from '../analyst/AnalystContext';
import type {
  AuditEvent,
  CaseAction,
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
  const { analystId, analysts, identitySignal } = useAnalyst();
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

  if (!caseResult.data || caseResult.loading) {
    return (
      <div className={styles.page}>
        <Loading />
      </div>
    );
  }

  const kase = caseResult.data;

  const handleSubmitAction = async (note: string) => {
    identitySignal.throwIfAborted();
    if (!openAction || !id) {
      return;
    }
    if (!kase.allowedActions.includes(openAction)) {
      throw new ApiError(403, 'FORBIDDEN', 'This action is no longer available.');
    }
    await postCaseAction(id, openAction, note, analystId, identitySignal);
    identitySignal.throwIfAborted();
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

      {riskResult.data ? (
        <RiskPanel explanation={riskResult.data} />
      ) : riskResult.error ? (
        <ErrorState error={riskResult.error} onRetry={riskResult.reload} />
      ) : (
        <Loading />
      )}
      <CustomerSection customer={kase.customer} />

      <section className={styles.section}>
        <h2>Actions</h2>
        {kase.allowedActions.length === 0 ? (
          <p className={styles.closed}>
            {kase.status === 'approved' || kase.status === 'rejected'
              ? 'Case closed — no further actions available.'
              : 'Your role has no permitted actions for this case.'}
          </p>
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
          approvalNoteRequired={kase.approvalNoteRequired}
          signal={identitySignal}
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

export function RiskPanel({ explanation }: { explanation: RiskExplanation }) {
  const factors = useMemo(
    () => [...explanation.factors].sort((a, b) => b.weight - a.weight),
    [explanation.factors],
  );
  const primaryDriver = explanation.primaryDriver ?? factors[0] ?? null;
  const title = explanation.riskLevel === 'high'
    ? 'Why is this case high risk?'
    : explanation.riskLevel === 'medium'
      ? 'Why does this case need review?'
      : 'How was this risk score calculated?';

  return (
    <section className={`${styles.riskExplanation} ${styles[explanation.riskLevel] ?? ''}`}>
      <div className={styles.riskHeading}>
        <div>
          <div className={styles.eyebrow}>Risk explanation</div>
          <h2>{title}</h2>
        </div>
        <span className={styles.deterministic}>Structured evidence</span>
      </div>

      <div className={styles.riskOverview}>
        <div className={styles.scorePanel}>
          <span className={styles.scoreLabel}>Risk score</span>
          <div>
            <strong className={styles.score}>{explanation.riskScore}</strong>
            <span className={styles.scoreMax}>/100</span>
          </div>
          <div className={styles.riskLevelBadge}>
            <Badge kind="risk" value={explanation.riskLevel} />
          </div>
          <div className={styles.scoreTrack} aria-hidden="true">
            <span
              className={styles.scoreFill}
              style={{ width: `${Math.min(100, Math.max(0, explanation.riskScore))}%` }}
            />
          </div>
          <span className={styles.threshold}>
            High risk starts at {explanation.thresholds.high}
          </span>
        </div>

        <div className={styles.factorPanel}>
          <h3>
            {factors.length} contributing {factors.length === 1 ? 'factor' : 'factors'}
          </h3>
          {factors.length === 0 ? (
            <p className={styles.noFactors}>No structured risk signals were recorded.</p>
          ) : (
            <ol className={styles.factorList}>
              {factors.map((factor) => (
                <li key={factor.signalId} className={styles.factorRow}>
                  <span
                    className={`${styles.severityDot} ${styles[`severity_${factor.severity}`] ?? ''}`}
                    aria-label={`${factor.severity} severity`}
                  />
                  <span className={styles.factorTitle}>{factor.title}</span>
                  <strong className={styles.factorWeight}>+{factor.weight}</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {primaryDriver ? (
        <div className={styles.primaryDriver}>
          <span>Primary driver</span>
          <strong>{primaryDriver.title}</strong>
          <span>+{primaryDriver.weight} points</span>
        </div>
      ) : null}

      <p>{explanation.summary}</p>

      {factors.length > 0 ? (
        <details className={styles.evidence}>
          <summary>View supporting evidence</summary>
          <p className={styles.evidenceIntro}>
            These recorded signals are the structured evidence used to explain the score.
          </p>
          <div className={styles.evidenceList}>
            {factors.map((factor) => (
              <article key={factor.signalId} className={styles.evidenceItem}>
                <div className={styles.evidenceHead}>
                  <Badge kind="severity" value={factor.severity} />
                  <strong>{factor.title}</strong>
                  <span>+{factor.weight} points · {factor.contributionPct}% of raw score</span>
                </div>
                <p>{factor.description}</p>
                <code>Evidence record {factor.signalId}</code>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      <p className={styles.explanationFootnote}>
        Deterministic result from recorded risk signals
        {explanation.scoreCapped
          ? ` · Raw signal total ${explanation.rawScore}, capped at 100`
          : ` · Signal total ${explanation.rawScore}`}
      </p>
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
