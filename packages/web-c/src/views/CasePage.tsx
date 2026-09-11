import type { ReactNode } from 'react';
import type {
  Analyst,
  AuditEvent,
  CaseAction,
  CaseDetail,
  Customer,
  RiskExplanation,
  RiskLevel,
  RiskSignal,
} from '../api/types.js';
import type { ChainVerification } from '../lib/audit.js';
import {
  STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatUsd,
  humanise,
  shortHash,
  yesNo,
} from '../lib/format.js';
import { ACTION_LABELS, NOTE_MAX, NOTE_MIN, noteRule } from '../lib/validation.js';
import { Flag, RiskBadge, SeverityBadge, StatusBadge } from './components.js';

export interface CasePageProps {
  kase: CaseDetail;
  explanation: RiskExplanation | null;
  chain: ChainVerification;
  analysts: Analyst[];
}

function caseUrl(id: string): string {
  return `/cases/${encodeURIComponent(id)}`;
}

function actionUrl(id: string, action: CaseAction): string {
  return `${caseUrl(id)}/actions/${action}`;
}

function analystName(analysts: Analyst[], id: string | null): string {
  if (id === null) return 'Unassigned';
  return analysts.find((a) => a.id === id)?.name ?? id;
}

function CaseHeader({ kase, analysts }: { kase: CaseDetail; analysts: Analyst[] }) {
  return (
    <div className="page-head case-head">
      <div>
        <p className="breadcrumb">
          <a href="/">Queue</a> / {kase.reference}
        </p>
        <h1>
          {kase.reference} <StatusBadge status={kase.status} />
        </h1>
        <p className="muted">
          {kase.customer.fullName} · Assigned to {analystName(analysts, kase.assignedTo)} · Created{' '}
          {formatDateTime(kase.createdAt)} · Updated {formatDateTime(kase.updatedAt)}
        </p>
      </div>
      <div className="risk-summary">
        <RiskBadge level={kase.riskLevel} />
        <span className="risk-score">{kase.riskScore}</span>
        <span className="muted">/ 100</span>
      </div>
    </div>
  );
}

function Actions({ kase }: { kase: CaseDetail }) {
  if (kase.allowedActions.length === 0) {
    return (
      <section className="panel actions" aria-label="Actions">
        <p className="notice">
          <strong>Case closed.</strong> This case is {STATUS_LABELS[kase.status].toLowerCase()}; no further actions
          are available.
        </p>
      </section>
    );
  }
  return (
    <section className="panel actions" aria-label="Actions">
      <span className="muted">Actions:</span>
      {kase.allowedActions.map((action) => (
        <a
          key={action}
          className={`btn btn-action-${action}`}
          href={actionUrl(kase.id, action)}
          hx-get={actionUrl(kase.id, action)}
          hx-target="#dialog-slot"
          hx-swap="innerHTML"
        >
          {ACTION_LABELS[action]}
        </a>
      ))}
      {kase.status === 'escalated' ? (
        <span className="muted">Escalated cases can only be resolved by a senior analyst.</span>
      ) : null}
    </section>
  );
}

function CustomerSection({ customer }: { customer: Customer }) {
  const rows: Array<[string, ReactNode]> = [
    ['Full name', customer.fullName],
    ['Customer ID', customer.id],
    ['Date of birth', formatDate(customer.dateOfBirth)],
    ['Nationality', customer.nationality],
    ['Country of residence', customer.countryOfResidence],
    ['Occupation', humanise(customer.occupation)],
    ['Email', customer.email],
    ['Account opened', formatDate(customer.accountOpenedAt)],
    ['Expected monthly volume', formatUsd(customer.expectedMonthlyVolumeUsd)],
    ['Source of funds', humanise(customer.sourceOfFunds)],
    ['ID document type', humanise(customer.idDocumentType)],
    ['ID document verified', <Flag value={customer.idDocumentVerified} />],
    ['Address verified', <Flag value={customer.addressVerified} />],
    ['PEP flag', yesNo(customer.pepFlag)],
    ['Sanctions hit', yesNo(customer.sanctionsHit)],
    ['Adverse media hits', String(customer.adverseMediaHits)],
  ];
  return (
    <section className="panel">
      <h2>Customer information</h2>
      <dl className="kv">
        {rows.map(([label, value]) => (
          <div key={label} className="kv-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SignalsSection({ signals }: { signals: RiskSignal[] }) {
  return (
    <section className="panel">
      <h2>Risk signals</h2>
      {signals.length === 0 ? (
        <p className="muted">No risk signals recorded.</p>
      ) : (
        <ul className="signals">
          {signals.map((s) => (
            <li key={s.id} className="signal">
              <SeverityBadge severity={s.severity} />
              <div className="signal-body">
                <strong>{s.title}</strong> <code className="muted">{s.code}</code>
                <p>{s.description}</p>
              </div>
              <span className="signal-weight" title="Weight">
                +{s.weight}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RiskPanel({ explanation, riskLevel }: { explanation: RiskExplanation | null; riskLevel: RiskLevel }) {
  const title = riskLevel === 'high' ? 'Why is this case high risk?' : 'Risk assessment';
  if (!explanation) {
    return (
      <section className="panel risk-panel">
        <h2>{title}</h2>
        <p className="error-text">The risk explanation could not be loaded.</p>
      </section>
    );
  }
  const factors = [...explanation.factors].sort((a, b) => b.weight - a.weight);
  return (
    <section className="panel risk-panel">
      <h2>{title}</h2>
      <p className="summary">{explanation.summary}</p>
      <div className="meter-row">
        <meter
          className="score-meter"
          min={0}
          max={100}
          low={explanation.thresholds.medium}
          high={explanation.thresholds.high}
          optimum={0}
          value={explanation.riskScore}
        >
          {explanation.riskScore} / 100
        </meter>
        <span className="muted">
          Score <strong>{explanation.riskScore}</strong> · medium ≥ {explanation.thresholds.medium} · high ≥{' '}
          {explanation.thresholds.high}
        </span>
      </div>
      {factors.length === 0 ? (
        <p className="muted">No contributing factors.</p>
      ) : (
        <table className="factors">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">Severity</th>
              <th scope="col" className="num">
                Weight
              </th>
              <th scope="col">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {factors.map((f) => (
              <tr key={f.code}>
                <td>
                  <strong>{f.title}</strong>
                  <div className="muted small">{f.description}</div>
                </td>
                <td>
                  <SeverityBadge severity={f.severity} />
                </td>
                <td className="num">{f.weight}</td>
                <td className="contrib">
                  <meter min={0} max={100} value={f.contributionPct}>
                    {f.contributionPct}%
                  </meter>{' '}
                  {f.contributionPct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AuditSection({ audit, chain }: { audit: AuditEvent[]; chain: ChainVerification }) {
  const events = [...audit].sort((a, b) => b.sequence - a.sequence);
  return (
    <section className="panel" id="audit-section">
      <div className="section-head">
        <h2>Audit history</h2>
        {chain.valid ? (
          <span className="chain chain-ok" title="Every event hash recomputed server-side matches">
            ✓ Chain verified ({events.length} events)
          </span>
        ) : (
          <span className="chain chain-bad" title={`First mismatch at sequence ${chain.brokenAt ?? '?'}`}>
            ✕ Chain broken at #{chain.brokenAt ?? '?'}
          </span>
        )}
      </div>
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id} className={chain.eventValid[e.id] === false ? 'event event-bad' : 'event'}>
            <div className="event-head">
              <strong>{e.actorName}</strong> <span className="muted">({e.actorId})</span> ·{' '}
              <code>{e.action}</code>
              {e.fromStatus || e.toStatus ? (
                <span className="transition">
                  {' '}
                  {e.fromStatus ? STATUS_LABELS[e.fromStatus] : '∅'} → {e.toStatus ? STATUS_LABELS[e.toStatus] : '∅'}
                </span>
              ) : null}
            </div>
            {e.note ? <p className="event-note">{e.note}</p> : null}
            <div className="event-meta muted">
              <span>#{e.sequence}</span> · <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time> ·{' '}
              <code title={e.hash} className="hash">
                {shortHash(e.hash)}…
              </code>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Everything below the header that is swapped after an action. */
export function CaseMain({ kase, explanation, chain, analysts }: CasePageProps) {
  return (
    <div id="case-main">
      <CaseHeader kase={kase} analysts={analysts} />
      <Actions kase={kase} />
      <div className="grid-2">
        <CustomerSection customer={kase.customer} />
        <div className="stack">
          <RiskPanel explanation={explanation} riskLevel={kase.riskLevel} />
          <SignalsSection signals={kase.signals} />
        </div>
      </div>
      <AuditSection audit={kase.audit} chain={chain} />
    </div>
  );
}

export interface ActionDialogProps {
  kase: Pick<CaseDetail, 'id' | 'reference' | 'riskLevel' | 'status'>;
  action: CaseAction;
  note: string;
  error: string | null;
}

export function ActionDialog({ kase, action, note, error }: ActionDialogProps) {
  const rule = noteRule(action, kase.riskLevel);
  const titleId = 'action-dialog-title';
  return (
    <dialog id="action-dialog" className="dialog" open aria-labelledby={titleId}>
      <form
        method="post"
        action={actionUrl(kase.id, action)}
        hx-post={actionUrl(kase.id, action)}
        hx-target="#case-main"
        hx-swap="outerHTML"
      >
        <h2 id={titleId}>
          {ACTION_LABELS[action]} {kase.reference}
        </h2>
        <p className="muted">
          Case is <RiskBadge level={kase.riskLevel} /> risk, currently {STATUS_LABELS[kase.status].toLowerCase()}.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <label htmlFor="note">
          Note {rule.required ? <span className="required">(required)</span> : <span className="muted">(optional)</span>}
        </label>
        <textarea
          id="note"
          name="note"
          rows={4}
          autoFocus
          defaultValue={note}
          maxLength={NOTE_MAX}
          minLength={rule.required && action !== 'approve' ? NOTE_MIN : undefined}
          required={rule.required}
          aria-describedby="note-hint"
        />
        <p id="note-hint" className="muted small">
          {rule.hint}
        </p>
        <div className="dialog-actions">
          <a className="btn" href={caseUrl(kase.id)} data-dialog-close>
            Cancel
          </a>
          <button type="submit" className={`btn btn-primary btn-action-${action}`}>
            Confirm {ACTION_LABELS[action].toLowerCase()}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function NotFoundCase({ id }: { id: string }) {
  return (
    <section className="panel error-panel">
      <h1>Case not found</h1>
      <p>
        No case exists with id <code>{id}</code>.
      </p>
      <p>
        <a className="btn" href="/">
          Back to queue
        </a>
      </p>
    </section>
  );
}
