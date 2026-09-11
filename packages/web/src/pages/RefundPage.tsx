import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAnalyst } from '../analyst/AnalystContext';
import { ApiError } from '../api/client';
import { getRefund, postRefundAction } from '../api/refunds';
import type { RefundAction, RefundDetail } from '../api/types';
import { useApi } from '../api/useApi';
import { ActionDialog } from '../components/ActionDialog';
import { AuditTimeline } from '../components/AuditTimeline';
import { Badge } from '../components/Badge';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { Toast } from '../components/Toast';
import { ACTION_LABELS } from '../lib/actionRules';
import { formatDateTime, formatUsdCents } from '../lib/format';
import styles from '../components/Detail.module.css';

export function RefundPage() {
  const { id } = useParams<{ id: string }>();
  const { analystId, identitySignal } = useAnalyst();
  const result = useApi((signal) => getRefund(id ?? '', analystId, signal), [id, analystId]);
  const [openAction, setOpenAction] = useState<RefundAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const submit = async (note: string) => {
    identitySignal.throwIfAborted();
    if (!openAction || !id || !result.data) return;
    if (!result.data.allowedActions.includes(openAction)) {
      throw new ApiError(403, 'FORBIDDEN', 'This action is no longer available.');
    }
    await postRefundAction(id, openAction, note, analystId, identitySignal);
    identitySignal.throwIfAborted();
    setToast(`Refund ${result.data.reference}: ${ACTION_LABELS[openAction]} succeeded`);
    setOpenAction(null);
    result.reload();
  };

  return (
    <div className={styles.page}>
      <Link to="/refunds" className={styles.back}>← Back to refunds</Link>
      {result.error ? (
        result.error.status === 404 ? <h1>Refund not found</h1> : <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.loading || !result.data ? <Loading /> : (
        <>
          <RefundRecord refund={result.data} onAction={setOpenAction} />
          <AuditTimeline events={result.data.audit} />
          {openAction ? (
            <ActionDialog
              action={openAction}
              approvalNoteRequired={result.data.approvalNoteRequired}
              signal={identitySignal}
              subjectLabel={`refund ${result.data.reference}`}
              onClose={() => setOpenAction(null)}
              onSubmit={submit}
            />
          ) : null}
        </>
      )}
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export function RefundRecord({ refund, onAction }: { refund: RefundDetail; onAction: (action: RefundAction) => void }) {
  return (
    <>
      <div className={styles.header}>
        <h1>Refund {refund.reference}</h1>
        <Badge kind="status" value={refund.status} />
        <Badge kind="risk" value={refund.riskLevel} />
        <div className={styles.headerMeta}>
          Created {formatDateTime(refund.createdAt)} · Updated {formatDateTime(refund.updatedAt)}
        </div>
      </div>
      <section className={styles.section}>
        <h2>Refund details</h2>
        <dl className={styles.defList}>
          <dt>Customer</dt><dd>{refund.customer.fullName} ({refund.customer.email})</dd>
          <dt>Original transaction</dt><dd className="mono">{refund.originalTransaction.reference}</dd>
          <dt>Transaction date</dt><dd>{formatDateTime(refund.originalTransaction.occurredAt)}</dd>
          <dt>Transaction amount</dt><dd>{formatUsdCents(refund.originalTransaction.amountCents)}</dd>
          <dt>Refund amount</dt><dd><strong>{formatUsdCents(refund.amountCents)}</strong> USD</dd>
          <dt>Reason</dt><dd>{refund.reason}</dd>
        </dl>
      </section>
      <section className={styles.section}>
        <h2>Risk indicators</h2>
        {refund.riskIndicators.length === 0 ? <p>No risk indicators recorded.</p> : refund.riskIndicators.map((indicator) => (
          <div key={indicator.code}>
            <Badge kind="severity" value={indicator.severity} /> <strong>{indicator.title}</strong>
            <p>{indicator.description}</p>
          </div>
        ))}
      </section>
      <section className={styles.section}>
        <h2>Actions</h2>
        <p>Approval records a decision; payment execution is outside this prototype.</p>
        {refund.allowedActions.length === 0 ? (
          <p className={styles.closed}>
            {refund.status === 'pending'
              ? 'Your role has no permitted decisions for this refund. Senior analysts may decide low/medium-risk refunds up to $5,000; other refunds require a compliance manager.'
              : 'Refund closed — no further actions available.'}
          </p>
        ) : (
          <div className={styles.actions}>
            {refund.allowedActions.map((action) => (
              <button key={action} type="button" className={action === 'approve' ? 'primary' : 'danger'} onClick={() => onAction(action)}>
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
