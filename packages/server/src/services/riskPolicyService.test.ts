import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db.js';
import { verifyChain } from '../domain/audit.js';
import { computeRisk, explainRisk } from '../domain/risk.js';
import { REFUND_ACTORS, refundFixtureContext } from '../refundFixtures.js';
import { listAuditEvents } from '../repo/audit.js';
import { getCase, getCaseRiskThresholds } from '../repo/cases.js';
import { getCustomer } from '../repo/customers.js';
import { listSignals, replaceSignals } from '../repo/signals.js';
import { applyCaseAction } from './caseService.js';
import { updateRiskPolicy } from './riskPolicyService.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  refundFixtureContext(db);
  db.exec(`UPDATE customers SET pep_flag = 1, sanctions_hit = 1,
    id_document_verified = 0, nationality = 'IR' WHERE id = 'cus-001'`);
  const evaluation = computeRisk(getCustomer(db, 'cus-001')!, new Date());
  db.prepare(`INSERT INTO cases (id, reference, customer_id, status, risk_score, risk_level,
    created_at, updated_at) VALUES ('capped', 'KYC-CAPPED', 'cus-001', 'pending', ?, ?, ?, ?)`)
    .run(evaluation.score, evaluation.level, '2026-09-01', '2026-09-01');
  replaceSignals(db, 'capped', evaluation.signals);
});
afterEach(() => db.close());

describe('risk evaluation persistence', () => {
  it('audits changed evidence even when both scores remain capped at 100', () => {
    const change = updateRiskPolicy(db, 'ana-006', { weights: { SANCTIONS_HIT: 41 } });
    expect(change.change?.recomputedCases).toBe(1);
    expect(getCase(db, 'capped')?.riskScore).toBe(100);
    expect(listSignals(db, 'capped').find((signal) => signal.code === 'SANCTIONS_HIT')?.weight).toBe(41);
    const events = listAuditEvents(db, 'capped');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: 'ana-006', action: 'RISK_RESCORED' });
    expect(events[0]?.note).toContain('Evidence updated');
    expect(verifyChain(events)).toBe(true);
  });

  it('preserves closed-case evidence and thresholds across later policy versions', () => {
    updateRiskPolicy(db, 'ana-006', { thresholds: { high: 70 } });
    expect(getCaseRiskThresholds(db, 'capped')).toEqual({ medium: 30, high: 70 });
    applyCaseAction(db, 'capped', REFUND_ACTORS.compliance_manager, 'approve', 'Reviewed all supporting evidence.');
    const before = {
      kase: getCase(db, 'capped')!,
      signals: listSignals(db, 'capped'),
      audit: listAuditEvents(db, 'capped'),
    };
    updateRiskPolicy(db, 'ana-006', { weights: { PEP: 5 }, thresholds: { high: 80 } });
    expect(getCase(db, 'capped')).toEqual(before.kase);
    expect(listSignals(db, 'capped')).toEqual(before.signals);
    expect(listAuditEvents(db, 'capped')).toEqual(before.audit);
    const explanation = explainRisk(before.kase, before.signals, getCaseRiskThresholds(db, 'capped'));
    expect(explanation.thresholds.high).toBe(70);
    expect(explanation.summary).not.toContain('does not match');
  });

  it('rolls back threshold snapshots and evidence when audit insertion fails', () => {
    const signals = listSignals(db, 'capped');
    db.exec(`CREATE TRIGGER audit_failure BEFORE INSERT ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    expect(() => updateRiskPolicy(db, 'ana-006', { thresholds: { high: 70 } })).toThrow('audit unavailable');
    expect(db.prepare('SELECT * FROM case_risk_thresholds').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM risk_policy').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM risk_policy_changes').all()).toEqual([]);
    expect(listSignals(db, 'capped')).toEqual(signals);
  });

  it('re-resolves revoked and unknown actors inside the service transaction', () => {
    db.exec("UPDATE analysts SET role = 'analyst' WHERE id = 'ana-006'");
    expect(() => updateRiskPolicy(db, 'ana-006', { thresholds: { high: 70 } }))
      .toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => updateRiskPolicy(db, 'unknown', { thresholds: { high: 70 } }))
      .toThrowError(expect.objectContaining({ status: 401 }));
    expect(db.prepare('SELECT * FROM risk_policy_changes').all()).toEqual([]);
  });
});
