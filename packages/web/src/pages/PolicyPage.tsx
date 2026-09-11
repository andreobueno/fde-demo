import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, getMe, getPolicy, getPolicyAudit, updatePolicy } from '../api/client';
import type { Policy, PolicyAuditEvent } from '../api/types';
import { useApi } from '../api/useApi';
import { useAnalyst } from '../analyst/AnalystContext';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { Toast } from '../components/Toast';
import { validateNote } from '../lib/actionRules';
import { formatDateTime, humanize } from '../lib/format';
import styles from '../components/Detail.module.css';

export function PolicyPage() {
  const { analystId } = useAnalyst();
  const policyResult = useApi((signal) => getPolicy(analystId, signal), [analystId]);
  const auditResult = useApi((signal) => getPolicyAudit(analystId, signal), [analystId]);
  const meResult = useApi((signal) => getMe(analystId, signal), [analystId]);
  const [toast, setToast] = useState<string | null>(null);

  const reload = () => {
    policyResult.reload();
    auditResult.reload();
    meResult.reload();
  };

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.back}>← Back to queue</Link>
      <div className={styles.header}><h1>Review policy</h1></div>
      <section className={styles.section}>
        <h2>Approval justification</h2>
        <p>High-risk approvals always require a note of 10–1000 characters.</p>
        {policyResult.error ? (
          <ErrorState error={policyResult.error} onRetry={policyResult.reload} />
        ) : policyResult.loading || !policyResult.data ? (
          <Loading />
        ) : (
          <>
            <dl className={styles.defList}>
              <dt>Low / medium risk note</dt>
              <dd>{policyResult.data.requireApprovalNote ? 'Required (10–1000 characters)' : 'Optional (up to 1000 characters)'}</dd>
              <dt>Version</dt><dd>{policyResult.data.version}</dd>
              <dt>Updated</dt><dd>{formatDateTime(policyResult.data.updatedAt)}</dd>
              <dt>Updated by</dt><dd>{policyResult.data.updatedBy ?? 'Initial policy'}</dd>
            </dl>
            {meResult.error ? (
              <ErrorState error={meResult.error} onRetry={meResult.reload} />
            ) : meResult.loading || !meResult.data ? (
              <Loading />
            ) : meResult.data.role === 'compliance_manager' ? (
              <PolicyForm
                key={policyResult.data.version}
                policy={policyResult.data}
                onReload={reload}
                onSaved={() => {
                  setToast('Policy updated');
                  reload();
                }}
              />
            ) : (
              <p className={styles.closed}>Only compliance managers can edit policy.</p>
            )}
          </>
        )}
      </section>
      <section className={styles.section}>
        <h2>Policy history</h2>
        {auditResult.error ? (
          <ErrorState error={auditResult.error} onRetry={auditResult.reload} />
        ) : auditResult.loading || !auditResult.data ? (
          <Loading />
        ) : (
          <PolicyHistory events={auditResult.data} />
        )}
      </section>
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function PolicyForm({
  policy,
  onSaved,
  onReload,
}: {
  policy: Policy;
  onSaved: () => void;
  onReload: () => void;
}) {
  const { analystId, identitySignal } = useAnalyst();
  const [requireApprovalNote, setRequireApprovalNote] = useState(policy.requireApprovalNote);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);

  const submit = async () => {
    if (identitySignal.aborted || submitting || needsReload) {
      return;
    }
    const validation = validateNote(reason, true, 'Reason');
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updatePolicy({ version: policy.version, requireApprovalNote, reason }, analystId, identitySignal);
      identitySignal.throwIfAborted();
      onSaved();
    } catch (err) {
      if (identitySignal.aborted) {
        return;
      }
      if (err instanceof ApiError) {
        setNeedsReload(err.status === 409 || err.status === 403);
        setError(err.status === 409
          ? 'The policy changed while you were editing. Reload the latest policy before trying again.'
          : err.message);
      } else {
        setError('Unexpected error. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }} style={{ marginTop: 16 }}>
      <fieldset disabled={submitting || needsReload} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Edit policy</legend>
        <p>
          <label>
            <input type="checkbox" checked={requireApprovalNote} onChange={(event) => setRequireApprovalNote(event.target.checked)} />
            {' '}Require approval notes for low / medium risk cases
          </label>
        </p>
        <label htmlFor="policy-reason">Reason (required, 10–1000 characters)</label>
        <textarea
          id="policy-reason"
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          style={{ display: 'block', width: '100%', margin: '6px 0 12px' }}
        />
        <button type="submit" className="primary">{submitting ? 'Saving…' : 'Save policy'}</button>
      </fieldset>
      {error ? <p className={styles.bad} role="alert">{error}</p> : null}
      {needsReload ? <button type="button" onClick={onReload}>Reload policy and discard edits</button> : null}
    </form>
  );
}

function PolicyHistory({ events }: { events: PolicyAuditEvent[] }) {
  if (events.length === 0) {
    return <p className={styles.closed}>No policy changes recorded.</p>;
  }
  return (
    <div>
      {[...events].sort((a, b) => b.newState.version - a.newState.version).map((event) => (
        <div key={event.id} className={styles.event}>
          <div className={styles.eventHead}>
            <span className={styles.eventActor}>{event.actorName} ({humanize(event.actorRole)})</span>
            <span>{humanize(event.action)}</span>
            <span className={styles.eventTime}>{formatDateTime(event.createdAt)}</span>
          </div>
          <p>
            Version {event.previousState.version} → {event.newState.version}
            {' · '}Low / medium risk approval note: {event.previousState.requireApprovalNote ? 'Required' : 'Optional'}
            {' → '}{event.newState.requireApprovalNote ? 'Required' : 'Optional'}
          </p>
          <div className={styles.eventNote}>{event.reason}</div>
          <details className={styles.eventHash}>
            <summary>Audit details</summary>
            <p>Actor ID: {event.actorId}</p>
            <p>Event ID: {event.id}</p>
            <p style={{ overflowWrap: 'anywhere' }}>Previous hash: <span className="mono">{event.prevHash}</span></p>
            <p style={{ overflowWrap: 'anywhere' }}>Hash: <span className="mono">{event.hash}</span></p>
          </details>
        </div>
      ))}
    </div>
  );
}
