import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { openDb, type Db } from '../db.js';
import { computeEventHash, GENESIS_HASH, verifyChain } from '../domain/audit.js';
import { computePolicyEventHash, type PolicyAuditEvent, type ReviewPolicy } from '../domain/policy.js';
import { addRefund, REFUND_ACTORS } from '../refundFixtures.js';
import { insertAuditEvent } from '../repo/audit.js';
import type { AnalystRole, AuditEvent, CaseAction, CaseStatus, RiskExplanation, RiskLevel, RiskSignal } from '../types.js';
import { createApp } from './app.js';

const NOW = '2026-09-11T12:00:00.000Z';
const NOTE = 'Fictional evidence reviewed for this policy change.';
const ROLES = ['analyst', 'senior_analyst', 'compliance_manager'] as const;
const READ_PATHS = ['/api/policy', '/api/policy/audit', '/api/risk-policy', '/api/risk-policy/history'];

interface RiskPolicyView {
  version: number;
  rules: Array<{ code: string; weight: number; defaultWeight: number }>;
  thresholds: { medium: number; high: number };
  defaultThresholds: { medium: number; high: number };
  updatedBy: string | null;
  updatedAt: string | null;
}

interface RiskChange {
  id: string;
  version: number;
  actorId: string;
  actorName: string;
  changes: Array<{ key: string; from: number; to: number }>;
  recomputedCases: number;
  createdAt: string;
}

interface RiskUpdate {
  policy: RiskPolicyView;
  change: RiskChange | null;
}

interface CaseView {
  id: string;
  status: CaseStatus;
  riskScore: number;
  riskLevel: RiskLevel;
  assignedTo: string | null;
  allowedActions: CaseAction[];
  approvalNoteRequired: boolean;
  signals: RiskSignal[];
  audit: AuditEvent[];
}

let db: Db;
let app: ReturnType<typeof createApp>;

function addCase(id: string): void {
  db.prepare(`INSERT INTO customers (id, full_name, date_of_birth, nationality, country_of_residence,
    occupation, email, account_opened_at, expected_monthly_volume_usd, source_of_funds,
    id_document_type, id_document_verified, address_verified, pep_flag, sanctions_hit, adverse_media_hits)
    VALUES (?, 'Avery Fiction', '1990-01-01', 'US', 'US', 'teacher', ?, '2020-01-01',
    1000, 'salary', 'passport', 1, 1, 1, 0, 0)`).run(`${id}-customer`, `${id}@example.invalid`);
  db.prepare(`INSERT INTO cases (id, reference, customer_id, status, risk_level, risk_score,
    assigned_to, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 'medium', 30, NULL, ?, ?)`).run(
    id, `KYC-${id}`, `${id}-customer`, NOW, NOW,
  );
  db.prepare(`INSERT INTO risk_signals (id, case_id, code, title, description, severity, weight)
    VALUES (?, ?, 'PEP', 'PEP match',
    'Customer is identified as a politically exposed person (PEP).', 'high', 30)`).run(`signal-${id}`, id);
  const fields = {
    caseId: id, sequence: 1, actorId: REFUND_ACTORS.analyst.id,
    action: 'CASE_CREATED', fromStatus: null, toStatus: 'pending' as const,
    note: null, createdAt: NOW,
  };
  insertAuditEvent(db, {
    id: `creation-${id}`, ...fields, actorName: REFUND_ACTORS.analyst.name,
    prevHash: GENESIS_HASH, hash: computeEventHash(GENESIS_HASH, fields),
  });
}

async function read<T>(path: string, role: AnalystRole = 'compliance_manager'): Promise<T> {
  const response = await request(app).get(path).set('x-analyst-id', REFUND_ACTORS[role].id).expect(200);
  return response.body as T;
}

function put(path: string, body: object, role: AnalystRole = 'compliance_manager') {
  return request(app).put(path).set('x-analyst-id', REFUND_ACTORS[role].id).send(body);
}

function act(id: string, role: AnalystRole, body: object) {
  return request(app).post(`/api/cases/${id}/actions`)
    .set('x-analyst-id', REFUND_ACTORS[role].id).send(body);
}

async function setNotePolicy(required: boolean): Promise<ReviewPolicy> {
  const before = await read<ReviewPolicy>('/api/policy');
  const response = await put('/api/policy', {
    version: before.version, requireApprovalNote: required, reason: NOTE,
  }).expect(200);
  return response.body as ReviewPolicy;
}

async function setRiskPolicy(body: object): Promise<RiskUpdate> {
  const response = await put('/api/risk-policy', body).expect(200);
  return response.body as RiskUpdate;
}

function caseRecords() {
  return {
    cases: db.prepare('SELECT * FROM cases ORDER BY id').all(),
    signals: db.prepare('SELECT * FROM risk_signals ORDER BY id').all(),
    audit: db.prepare('SELECT * FROM audit_events ORDER BY id').all(),
    refunds: db.prepare('SELECT * FROM refunds ORDER BY id').all(),
  };
}

async function policies() {
  return {
    review: await read<ReviewPolicy>('/api/policy'),
    reviewAudit: await read<PolicyAuditEvent[]>('/api/policy/audit'),
    risk: await read<RiskPolicyView>('/api/risk-policy'),
    riskHistory: await read<RiskChange[]>('/api/risk-policy/history'),
  };
}

function expectAppend(before: AuditEvent[], after: AuditEvent[], action: string): void {
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, -1)).toEqual(before);
  expect(after.at(-1)).toMatchObject({
    action, sequence: before.length + 1, prevHash: before.at(-1)!.hash,
  });
  expect(verifyChain(after)).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  db = openDb(':memory:');
  for (const actor of Object.values(REFUND_ACTORS)) {
    db.prepare('INSERT INTO analysts (id, name, role) VALUES (?, ?, ?)').run(actor.id, actor.name, actor.role);
  }
  app = createApp(db);
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('approval-note and risk-scoring policy coexistence', () => {
  it('keeps independent contracts, versions and histories when updates are interleaved', async () => {
    addCase('open');
    const initial = await policies();
    expect(initial.review).toMatchObject({ version: 1, requireApprovalNote: true, updatedBy: null });
    expect(initial.review).not.toHaveProperty('rules');
    expect(initial.risk).toMatchObject({
      version: 0, thresholds: { medium: 30, high: 60 }, defaultThresholds: { medium: 30, high: 60 },
      updatedAt: null, updatedBy: null,
    });
    expect(initial.risk.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PEP', weight: 30, defaultWeight: 30 }),
      expect.objectContaining({ code: 'SANCTIONS_HIT', weight: 40, defaultWeight: 40 }),
    ]));
    expect(initial.risk).not.toHaveProperty('requireApprovalNote');
    expect(initial.reviewAudit).toEqual([]);
    expect(initial.riskHistory).toEqual([]);

    const originalRecords = caseRecords();
    const relaxed = await setNotePolicy(false);
    expect(relaxed.version).toBe(2);
    expect(caseRecords()).toEqual(originalRecords);
    expect(await read('/api/risk-policy')).toEqual(initial.risk);
    expect(await read('/api/risk-policy/history')).toEqual([]);
    const reviewAudit = await read<PolicyAuditEvent[]>('/api/policy/audit');

    const first = await setRiskPolicy({ weights: { PEP: 40 } });
    expect(first.policy.version).toBe(1);
    expect(first.change).toMatchObject({
      version: 1, actorId: REFUND_ACTORS.compliance_manager.id,
      actorName: REFUND_ACTORS.compliance_manager.name,
      changes: [{ key: 'weights.PEP', from: 30, to: 40 }], recomputedCases: 1,
    });
    expect(first.policy.updatedAt).toBe(first.change!.createdAt);
    expect(first.policy.updatedBy).toBe(REFUND_ACTORS.compliance_manager.name);
    expect(await read('/api/policy')).toEqual(relaxed);
    expect(await read('/api/policy/audit')).toEqual(reviewAudit);

    const rescoredRecords = caseRecords();
    const strict = await setNotePolicy(true);
    expect(strict.version).toBe(3);
    expect(caseRecords()).toEqual(rescoredRecords);
    expect(await read('/api/risk-policy')).toEqual(first.policy);
    expect(await read('/api/risk-policy/history')).toEqual([first.change]);

    const second = await setRiskPolicy({ thresholds: { high: 70 } });
    expect(second.policy).toMatchObject({ version: 2, thresholds: { medium: 30, high: 70 } });
    expect(second.change).toMatchObject({
      version: 2, changes: [{ key: 'thresholds.high', from: 60, to: 70 }],
    });
    expect(await read('/api/risk-policy/history')).toEqual([second.change, first.change]);
    expect(await read('/api/policy')).toEqual(strict);
    const history = await read<PolicyAuditEvent[]>('/api/policy/audit');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ previousState: initial.review, newState: relaxed, prevHash: GENESIS_HASH });
    expect(history[1]).toMatchObject({ previousState: relaxed, newState: strict, prevHash: history[0]!.hash });
    for (const event of history) expect(event.hash).toBe(computePolicyEventHash(event));
  });

  it.each(ROLES)('lets %s read both sections and uses its database role for writes', async (role) => {
    const before = await policies();
    for (const path of READ_PATHS) {
      expect(await read(path, role)).toEqual(await read(path));
    }
    if (role === 'compliance_manager') return;
    await put('/api/policy', { version: 1, requireApprovalNote: false, reason: NOTE }, role)
      .set('x-role', 'compliance_manager').expect(403);
    await put('/api/risk-policy', { weights: { PEP: 50 } }, role)
      .set('x-role', 'compliance_manager').expect(403);
    expect(await policies()).toEqual(before);
  });

  it.each([undefined, 'unknown-fictional-identity'])('requires known identity %s on every policy route', async (identity) => {
    const before = caseRecords();
    for (const path of READ_PATHS) {
      const req = request(app).get(path);
      if (identity) req.set('x-analyst-id', identity);
      await req.expect(401);
    }
    for (const [path, body] of [
      ['/api/policy', { version: 1, requireApprovalNote: false, reason: NOTE }],
      ['/api/risk-policy', { weights: { PEP: 50 } }],
    ] as const) {
      const req = request(app).put(path).send(body).set('x-role', 'compliance_manager');
      if (identity) req.set('x-analyst-id', identity);
      await req.expect(401);
    }
    expect(caseRecords()).toEqual(before);
    expect(await read('/api/policy/audit')).toEqual([]);
  });

  it('rechecks a demoted manager and records the current database name after promotion', async () => {
    const before = await policies();
    const manager = REFUND_ACTORS.compliance_manager;
    db.prepare('UPDATE analysts SET role = ? WHERE id = ?').run('senior_analyst', manager.id);
    await put('/api/risk-policy', { weights: { PEP: 50 } }).set('x-role', 'compliance_manager').expect(403);
    await put('/api/policy', { version: 1, requireApprovalNote: false, reason: NOTE })
      .set('x-role', 'compliance_manager').expect(403);
    expect(await policies()).toEqual(before);
    db.prepare('UPDATE analysts SET role = ?, name = ? WHERE id = ?')
      .run('compliance_manager', 'Renamed Fictional Manager', manager.id);
    const risk = await setRiskPolicy({ weights: { PEP: 50 } });
    expect(risk.change).toMatchObject({ actorId: manager.id, actorName: 'Renamed Fictional Manager' });
    expect(risk.policy.updatedBy).toBe('Renamed Fictional Manager');
    await setNotePolicy(false);
    expect(await read('/api/policy/audit')).toEqual([
      expect.objectContaining({
        actorId: manager.id, actorName: 'Renamed Fictional Manager', actorRole: 'compliance_manager',
      }),
    ]);
  });

  it('rejects cross-section bodies and invalid risk patches without partial writes', async () => {
    addCase('open');
    const before = await policies();
    const records = caseRecords();
    await put('/api/policy', { weights: { PEP: 50 } }).expect(400);
    const invalidRiskPatches = [
      { version: 1, requireApprovalNote: false, reason: NOTE },
      { weights: { PEP: 101 } },
      { weights: { PEP: 1.5 } },
      { weights: { UNKNOWN_RULE: 10 } },
      { weights: { PEP: 50 }, thresholds: { medium: 60, high: 60 } },
      { thresholds: { medium: 0 } },
    ];
    for (const body of invalidRiskPatches) await put('/api/risk-policy', body).expect(400);
    expect(await policies()).toEqual(before);
    expect(caseRecords()).toEqual(records);
  });

  it('preserves each section on no-ops and rejects a stale approval-note version', async () => {
    addCase('open');
    await setNotePolicy(false);
    await setRiskPolicy({ weights: { PEP: 40 } });
    db.prepare('UPDATE customers SET pep_flag = 0 WHERE id = ?').run('open-customer');
    const before = await policies();
    const records = caseRecords();
    for (const body of [{ weights: { PEP: 40 } }, {}, { thresholds: { high: 60 } }]) {
      expect(await setRiskPolicy(body)).toEqual({ policy: before.risk, change: null });
    }
    await put('/api/policy', {
      version: before.review.version, requireApprovalNote: false, reason: NOTE,
    }).expect(400);
    await put('/api/policy', { version: 1, requireApprovalNote: true, reason: NOTE }).expect(409);
    expect(await policies()).toEqual(before);
    expect(caseRecords()).toEqual(records);
  });

  it('rolls back every case, signal, policy and history if a later rescore audit insertion fails', async () => {
    addCase('first');
    addCase('second');
    await setRiskPolicy({ weights: { PEP: 40 } });
    await setNotePolicy(false);
    const before = await policies();
    const records = caseRecords();
    const explanations = await Promise.all(['first', 'second'].map((id) =>
      read<RiskExplanation>(`/api/cases/${id}/risk-explanation`),
    ));
    const storedRisk = db.prepare('SELECT * FROM risk_policy ORDER BY key').all();
    const histories = db.prepare('SELECT * FROM risk_policy_changes ORDER BY version').all();
    db.exec(`CREATE TRIGGER fail_later_rescore BEFORE INSERT ON audit_events
      WHEN NEW.action = 'RISK_RESCORED'
        AND (SELECT count(*) FROM audit_events WHERE action = 'RISK_RESCORED') = 3
      BEGIN SELECT RAISE(ABORT, 'simulated rescore audit outage'); END;`);
    await put('/api/risk-policy', { weights: { PEP: 70 }, thresholds: { high: 65 } }).expect(500);
    expect(await policies()).toEqual(before);
    expect(caseRecords()).toEqual(records);
    expect(db.prepare('SELECT * FROM risk_policy ORDER BY key').all()).toEqual(storedRisk);
    expect(db.prepare('SELECT * FROM risk_policy_changes ORDER BY version').all()).toEqual(histories);
    expect(await Promise.all(['first', 'second'].map((id) =>
      read<RiskExplanation>(`/api/cases/${id}/risk-explanation`),
    ))).toEqual(explanations);

    db.exec('DROP TRIGGER fail_later_rescore');
    const retry = await setRiskPolicy({ weights: { PEP: 70 }, thresholds: { high: 65 } });
    expect(retry.change).toMatchObject({ version: 2, recomputedCases: 2 });
    for (const id of ['first', 'second']) {
      const detail = await read<CaseView>(`/api/cases/${id}`);
      expect(detail).toMatchObject({ riskScore: 70, riskLevel: 'high' });
      expect(detail.audit.map((event) => event.sequence)).toEqual([1, 2, 3]);
      expect(verifyChain(detail.audit)).toBe(true);
    }
  });

  it.each(['policy_audit_events', 'risk_policy_changes'] as const)('rolls back writes when %s rejects history insertion', async (table) => {
    addCase('open');
    const before = await policies();
    const records = caseRecords();
    db.exec(`CREATE TRIGGER fail_policy_history BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'simulated policy history outage'); END;`);
    if (table === 'policy_audit_events') {
      await put('/api/policy', { version: 1, requireApprovalNote: false, reason: NOTE }).expect(500);
    } else {
      await put('/api/risk-policy', { weights: { PEP: 70 } }).expect(500);
    }
    expect(await policies()).toEqual(before);
    expect(caseRecords()).toEqual(records);
  });

  it('keeps saved risk, explanation and permitted decisions consistent across threshold changes', async () => {
    addCase('review');
    await act('review', 'senior_analyst', { action: 'start_review' }).expect(200);
    await setNotePolicy(false);
    await setRiskPolicy({ weights: { PEP: 40 } });
    const medium = await read<CaseView>('/api/cases/review', 'senior_analyst');
    expect(medium).toMatchObject({ riskScore: 40, riskLevel: 'medium', approvalNoteRequired: false });
    expect(medium.allowedActions).toEqual(expect.arrayContaining(['approve', 'reject']));

    await setRiskPolicy({ thresholds: { high: 35 } });
    const high = await read<CaseView>('/api/cases/review', 'senior_analyst');
    expect(high).toMatchObject({ riskScore: 40, riskLevel: 'high', approvalNoteRequired: true });
    expect(high.allowedActions).toEqual(['escalate']);
    expectAppend(medium.audit, high.audit, 'RISK_RESCORED');
    const explanation = await read<RiskExplanation>('/api/cases/review/risk-explanation');
    expect(explanation).toMatchObject({ riskScore: 40, riskLevel: 'high', thresholds: { medium: 30, high: 35 } });
    expect(explanation.factors).toEqual([expect.objectContaining({ code: 'PEP', weight: 40, contributionPct: 100 })]);
    expect(explanation.summary).not.toMatch(/does not match/);
    expect((await read<CaseView>('/api/cases/review', 'analyst')).allowedActions).toEqual(['escalate']);
    expect((await read<CaseView>('/api/cases/review')).allowedActions)
      .toEqual(expect.arrayContaining(['approve', 'reject']));
    await act('review', 'senior_analyst', { action: 'approve', note: NOTE }).expect(403);
    await act('review', 'analyst', { action: 'approve', note: NOTE }).expect(403);
    await act('review', 'compliance_manager', { action: 'approve' }).expect(400);
    expect((await read<CaseView>('/api/cases/review')).audit).toEqual(high.audit);

    await setRiskPolicy({ thresholds: { medium: 50, high: 60 } });
    const low = await read<CaseView>('/api/cases/review', 'senior_analyst');
    expect(low).toMatchObject({ riskScore: 40, riskLevel: 'low', approvalNoteRequired: false });
    expect(low.allowedActions).toEqual(expect.arrayContaining(['approve', 'reject']));
    expect(await read('/api/cases/review/risk-explanation')).toMatchObject({
      riskScore: 40, riskLevel: 'low', thresholds: { medium: 50, high: 60 },
    });
    const approved = await act('review', 'senior_analyst', { action: 'approve' }).expect(200);
    expect(approved.body.status).toBe('approved');
    expectAppend(low.audit, (approved.body as CaseView).audit, 'approve');
  });

  it('audits threshold-only and capped evidence changes but leaves unaffected open evidence alone', async () => {
    addCase('capped');
    db.prepare('UPDATE customers SET sanctions_hit = 1 WHERE id = ?').run('capped-customer');
    await setRiskPolicy({ weights: { PEP: 70 } });
    const original = await read<CaseView>('/api/cases/capped');
    expect(original).toMatchObject({ riskScore: 100, riskLevel: 'high' });
    const weighted = await setRiskPolicy({ weights: { PEP: 80 } });
    expect(weighted.change?.recomputedCases).toBe(1);
    const evidence = await read<CaseView>('/api/cases/capped');
    expect(evidence).toMatchObject({ riskScore: 100, riskLevel: 'high' });
    expect(evidence.signals).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PEP', weight: 80 })]));
    expectAppend(original.audit, evidence.audit, 'RISK_RESCORED');
    const thresholdUpdate = await setRiskPolicy({ thresholds: { high: 70 } });
    expect(thresholdUpdate.change?.recomputedCases).toBe(1);
    const thresholds = await read<CaseView>('/api/cases/capped');
    expect(thresholds).toMatchObject({ riskScore: 100, riskLevel: 'high' });
    expectAppend(evidence.audit, thresholds.audit, 'RISK_RESCORED');
    expect(await read('/api/cases/capped/risk-explanation')).toMatchObject({
      riskScore: 100, riskLevel: 'high', thresholds: { medium: 30, high: 70 },
    });

    const records = caseRecords();
    const unusedRule = await setRiskPolicy({ weights: { ADDRESS_UNVERIFIED: 25 } });
    expect(unusedRule.change).toMatchObject({ version: 4, recomputedCases: 0 });
    expect(caseRecords()).toEqual(records);
  });

  it('reads stored open-case evidence deterministically despite customer changes and elapsed time', async () => {
    addCase('open');
    await setRiskPolicy({ weights: { PEP: 40 }, thresholds: { medium: 35, high: 70 } });
    const before = await read<CaseView>('/api/cases/open');
    const explanation = await read<RiskExplanation>('/api/cases/open/risk-explanation');
    expect(explanation).toMatchObject({
      riskScore: before.riskScore, riskLevel: before.riskLevel, thresholds: { medium: 35, high: 70 },
    });
    expect(explanation.factors.map((factor) => ({
      code: factor.code, weight: factor.weight, description: factor.description,
    }))).toEqual(before.signals.map((signal) => ({
      code: signal.code, weight: signal.weight, description: signal.description,
    })));
    const records = caseRecords();
    db.prepare('UPDATE customers SET pep_flag = 0, sanctions_hit = 1, account_opened_at = ? WHERE id = ?')
      .run(NOW, 'open-customer');
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const after = await read<CaseView>('/api/cases/open');
    expect(after).toMatchObject({
      riskScore: before.riskScore, riskLevel: before.riskLevel,
      signals: before.signals, audit: before.audit,
    });
    expect(await read('/api/cases/open/risk-explanation')).toEqual(explanation);
    expect(caseRecords()).toEqual(records);
  });

  it('preserves approved and rejected cases, refunds and saved explanations after policy changes', async () => {
    for (const id of ['approved', 'rejected', 'escalated']) addCase(id);
    addRefund(db, { customerId: 'approved-customer' });
    await act('escalated', 'analyst', { action: 'escalate', note: NOTE }).expect(200);
    await setRiskPolicy({ weights: { PEP: 40 }, thresholds: { medium: 35, high: 70 } });
    await act('approved', 'senior_analyst', { action: 'approve', note: NOTE }).expect(200);
    await act('rejected', 'senior_analyst', { action: 'reject', note: NOTE }).expect(200);
    const closed = await Promise.all(['approved', 'rejected'].map(async (id) => ({
      detail: await read<CaseView>(`/api/cases/${id}`),
      explanation: await read<RiskExplanation>(`/api/cases/${id}/risk-explanation`),
      row: db.prepare('SELECT * FROM cases WHERE id = ?').get(id),
    })));
    const refund = await read('/api/refunds/refund-test');
    const refundRow = db.prepare('SELECT * FROM refunds WHERE id = ?').get('refund-test');
    const escalated = await read<CaseView>('/api/cases/escalated');

    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    db.prepare('UPDATE customers SET pep_flag = 0, sanctions_hit = 1 WHERE id = ?').run('approved-customer');
    expect(await read('/api/cases/approved/risk-explanation')).toEqual(closed[0]!.explanation);
    const result = await setRiskPolicy({ weights: { PEP: 80 }, thresholds: { medium: 20, high: 50 } });
    expect(result.change?.recomputedCases).toBe(1);
    const rescored = await read<CaseView>('/api/cases/escalated');
    expect(rescored).toMatchObject({
      status: 'escalated', riskScore: 80, riskLevel: 'high', assignedTo: escalated.assignedTo,
    });
    expectAppend(escalated.audit, rescored.audit, 'RISK_RESCORED');
    expect(rescored.audit.at(-1)).toMatchObject({
      fromStatus: 'escalated', toStatus: 'escalated', actorId: REFUND_ACTORS.compliance_manager.id,
    });
    for (const [index, id] of ['approved', 'rejected'].entries()) {
      const saved = closed[index]!;
      const detail = await read<CaseView>(`/api/cases/${id}`);
      expect(detail).toMatchObject({
        riskScore: saved.detail.riskScore, riskLevel: saved.detail.riskLevel,
        status: saved.detail.status, signals: saved.detail.signals, audit: saved.detail.audit,
      });
      expect(db.prepare('SELECT * FROM cases WHERE id = ?').get(id)).toEqual(saved.row);
      expect(await read(`/api/cases/${id}/risk-explanation`)).toEqual(saved.explanation);
      expect(verifyChain(detail.audit)).toBe(true);
    }
    await setNotePolicy(false);
    expect(await read('/api/refunds/refund-test')).toEqual(refund);
    expect(db.prepare('SELECT * FROM refunds WHERE id = ?').get('refund-test')).toEqual(refundRow);
    expect(await read('/api/cases/approved/risk-explanation')).toEqual(closed[0]!.explanation);
  });

  it('protects both policy histories and the existing KYC chain against SQL mutation and replacement', async () => {
    addCase('open');
    const original = await read<CaseView>('/api/cases/open');
    await setNotePolicy(false);
    await setRiskPolicy({ weights: { PEP: 40 } });
    const before = await policies();
    const detail = await read<CaseView>('/api/cases/open');
    expectAppend(original.audit, detail.audit, 'RISK_RESCORED');
    for (const table of ['policy_audit_events', 'risk_policy_changes', 'audit_events']) {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      expect(rows.length).toBeGreaterThan(0);
      for (const sql of [
        `UPDATE ${table} SET actor_name = 'Forged Name'`,
        `DELETE FROM ${table}`,
        `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`,
      ]) {
        expect(() => db.exec(sql)).toThrow(/append-only/);
        expect(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).toEqual(rows);
      }
    }
    expect(await policies()).toEqual(before);
    expect(await read('/api/cases/open/audit')).toEqual(detail.audit);
  });
});
