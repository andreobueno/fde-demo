import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, getMe, getRiskPolicy, getRiskPolicyHistory, putRiskPolicy } from '../api/client';
import { useApi } from '../api/useApi';
import { useAnalyst } from '../analyst/AnalystContext';
import type { RiskPolicy, RiskPolicyChange, RiskPolicyPatch } from '../api/types';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { Toast } from '../components/Toast';
import { formatDateTime } from '../lib/format';
import { buildPolicyPatch, type PolicyDraft, validatePolicyDraft } from '../lib/policyDraft';
import styles from './PolicyPage.module.css';

function draftFromPolicy(policy: RiskPolicy): PolicyDraft {
  return {
    weights: Object.fromEntries(policy.rules.map((r) => [r.code, String(r.weight)])),
    thresholds: {
      medium: String(policy.thresholds.medium),
      high: String(policy.thresholds.high),
    },
  };
}

export function RiskPolicyPage() {
  const { analystId, identitySignal } = useAnalyst();
  const meResult = useApi((signal) => getMe(analystId, signal), [analystId]);
  const me = meResult.data;
  const canEdit = me?.permissions.includes('policy:manage') ?? false;

  const policyResult = useApi((signal) => getRiskPolicy(analystId, signal), [analystId]);
  const historyResult = useApi((signal) => getRiskPolicyHistory(analystId, signal), [analystId]);

  const [draft, setDraft] = useState<PolicyDraft | null>(
    () => policyResult.data ? draftFromPolicy(policyResult.data) : null,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (policyResult.data) {
      setDraft(draftFromPolicy(policyResult.data));
      setSaveError(null);
    }
  }, [policyResult.data]);

  const policy = policyResult.data;
  const patch = useMemo<RiskPolicyPatch | null>(
    () => (policy && draft ? buildPolicyPatch(policy, draft) : null),
    [policy, draft],
  );
  const validationError = draft ? validatePolicyDraft(draft) : null;
  const dirty = patch !== null && Object.keys(patch).length > 0;

  if (policyResult.error) {
    return (
      <div className={styles.page}>
        <ErrorState error={policyResult.error} onRetry={policyResult.reload} />
      </div>
    );
  }
  if (!policy || !draft) {
    return (
      <div className={styles.page}>
        <Loading />
      </div>
    );
  }

  const setWeight = (code: string, value: string) =>
    setDraft((d) => (d ? { ...d, weights: { ...d.weights, [code]: value } } : d));
  const setThreshold = (level: 'medium' | 'high', value: string) =>
    setDraft((d) => (d ? { ...d, thresholds: { ...d.thresholds, [level]: value } } : d));

  const reset = () => {
    setDraft(draftFromPolicy(policy));
    setSaveError(null);
  };

  const restoreDefaults = () =>
    setDraft({
      weights: Object.fromEntries(policy.rules.map((r) => [r.code, String(r.defaultWeight)])),
      thresholds: {
        medium: String(policy.defaultThresholds.medium),
        high: String(policy.defaultThresholds.high),
      },
    });

  const save = async () => {
    if (!patch || !dirty || validationError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await putRiskPolicy(patch, analystId, identitySignal);
      const n = result.change?.recomputedCases ?? 0;
      setToast(
        result.change
          ? `Policy v${result.change.version} saved — ${n} open case${n === 1 ? '' : 's'} re-scored.`
          : 'No changes to save.',
      );
      policyResult.reload();
      historyResult.reload();
      meResult.reload();
    } catch (err) {
      if (identitySignal.aborted) return;
      setSaveError(err instanceof ApiError ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  const pct = (raw: string) => {
    const n = Number(raw);
    return `${Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0}%`;
  };
  const mediumPct = pct(draft.thresholds.medium);
  const highPct = pct(draft.thresholds.high);
  const scaleStyle = { '--medium': mediumPct, '--high': highPct } as CSSProperties;

  return (
    <div className={styles.page}>
      <Link to="/">← Back to queue</Link>
      <div className={styles.header} style={{ marginTop: 12 }}>
        <h1>Risk policy</h1>
        <span className={styles.code}>v{policy.version}</span>
      </div>
      <p className={styles.meta}>
        {policy.updatedAt
          ? `Last changed ${formatDateTime(policy.updatedAt)} by ${policy.updatedBy ?? 'unknown'}.`
          : 'Using default policy — no changes recorded yet.'}{' '}
        Scores are the sum of triggered rule weights (0–100). Saving re-scores all open cases;
        closed cases keep the score they were decided under.
      </p>

      {!canEdit ? (
        <div className={styles.notice} role="status">
          Read-only: only a Compliance Manager can change the risk policy.
          {me ? ` You are signed in as ${me.name} (${me.role.replace('_', ' ')}).` : ''}
        </div>
      ) : null}
      {meResult.error ? <ErrorState error={meResult.error} onRetry={meResult.reload} /> : null}

      <section className={styles.section}>
        <h2>Rule weights</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Code</th>
              <th className={styles.weightCell}>Weight</th>
            </tr>
          </thead>
          <tbody>
            {policy.rules.map((rule) => {
              const value = draft.weights[rule.code] ?? '';
              const changed = Number(value) !== rule.weight;
              return (
                <tr key={rule.code}>
                  <td>
                    <div className={styles.ruleTitle}>{rule.title}</div>
                    <div className={styles.ruleDesc}>{rule.description}</div>
                  </td>
                  <td className={styles.code}>{rule.code}</td>
                  <td className={styles.weightCell}>
                    <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        inputMode="numeric"
                        className={`${styles.weightInput} ${changed ? styles.dirty : ''}`}
                        value={value}
                        disabled={!canEdit || saving}
                        onChange={(e) => setWeight(rule.code, e.target.value)}
                        aria-label={`${rule.title} weight`}
                      />
                    {rule.weight !== rule.defaultWeight ? (
                      <span className={styles.defaultHint}>default {rule.defaultWeight}</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className={styles.section}>
        <h2>Risk level thresholds</h2>
        <div className={styles.scale} style={scaleStyle} aria-hidden="true">
          <div className={styles.scaleMarker} style={{ left: mediumPct }} />
          <div className={styles.scaleLabel} style={{ left: mediumPct }}>
            medium ≥ {draft.thresholds.medium || '?'}
          </div>
          <div className={styles.scaleMarker} style={{ left: highPct }} />
          <div className={styles.scaleLabel} style={{ left: highPct }}>
            high ≥ {draft.thresholds.high || '?'}
          </div>
        </div>
        <div className={styles.thresholds}>
          {(['medium', 'high'] as const).map((level) => (
            <div key={level} className={styles.thresholdCard}>
              <label>
                <div className={styles.thresholdLabel}>
                  {level === 'medium' ? 'Medium' : 'High'} risk from score
                </div>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  className={`${styles.weightInput} ${
                    Number(draft.thresholds[level]) !== policy.thresholds[level] ? styles.dirty : ''
                  }`}
                  value={draft.thresholds[level]}
                  disabled={!canEdit || saving}
                  onChange={(e) => setThreshold(level, e.target.value)}
                />
              </label>
              <div className={styles.thresholdHelp}>
                {level === 'medium'
                  ? 'Scores below this are low risk.'
                  : 'Approving a high-risk case requires a note.'}{' '}
                Default {policy.defaultThresholds[level]}.
              </div>
            </div>
          ))}
        </div>
      </section>

      {canEdit ? (
        <section className={styles.section}>
          <div className={styles.footer}>
            <button
              type="button"
              className="primary"
              disabled={!dirty || saving || validationError !== null}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save policy'}
            </button>
            <button type="button" disabled={!dirty || saving} onClick={reset}>
              Discard changes
            </button>
            <button type="button" disabled={saving} onClick={restoreDefaults}>
              Restore defaults
            </button>
            {validationError ? (
              <span className={styles.error} role="alert">
                {validationError}
              </span>
            ) : saveError ? (
              <span className={styles.error} role="alert">
                {saveError}
              </span>
            ) : dirty ? (
              <span className={styles.meta} style={{ margin: 0 }}>
                {Object.keys(patch?.weights ?? {}).length +
                  Object.keys(patch?.thresholds ?? {}).length}{' '}
                unsaved change(s)
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <HistorySection
        history={historyResult.data}
        error={historyResult.error}
        onRetry={historyResult.reload}
      />

      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function HistorySection({
  history,
  error,
  onRetry,
}: {
  history: RiskPolicyChange[] | null;
  error: ApiError | null;
  onRetry: () => void;
}) {
  return (
    <section className={styles.section}>
      <h2>Change history</h2>
      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : !history ? (
        <Loading />
      ) : history.length === 0 ? (
        <p className={styles.empty}>No policy changes yet.</p>
      ) : (
        history.map((c) => (
          <div key={c.id} className={styles.historyItem}>
            <div className={styles.historyHead}>
              <span className={styles.historyVersion}>v{c.version}</span>
              <span>{c.actorName}</span>
              <span className={styles.historyTime}>{formatDateTime(c.createdAt)}</span>
              <span className={styles.historyTime}>
                · {c.recomputedCases} open case{c.recomputedCases === 1 ? '' : 's'} re-scored
              </span>
            </div>
            <ul className={styles.historyChanges}>
              {c.changes.map((ch) => (
                <li key={ch.key}>
                  <span className={styles.code}>{ch.key}</span>: {ch.from} → {ch.to}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
