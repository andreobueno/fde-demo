import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb, type Db } from '../db.js';
import type { AuditEvent, CaseAction, CaseStatus, RiskLevel } from '../types.js';
import { createApp } from './app.js';

const ACTORS = {
  analyst: { id: 'auth-analyst', name: 'Robin Fiction', role: 'analyst' },
  senior_analyst: { id: 'ana-001', name: 'Sam Example', role: 'senior_analyst' },
  compliance_manager: { id: 'auth-manager', name: 'Morgan Imaginary', role: 'compliance_manager' },
} as const;
type Role = keyof typeof ACTORS;
const ROLES: Role[] = ['analyst', 'senior_analyst', 'compliance_manager'];
const RISKS: RiskLevel[] = ['low', 'medium', 'high'];
const STATUSES: CaseStatus[] = ['pending', 'in_review', 'escalated', 'approved', 'rejected'];
const ACTIONS: CaseAction[] = ['start_review', 'approve', 'reject', 'escalate'];
const TARGETS: Record<CaseAction, CaseStatus> = {
  start_review: 'in_review', approve: 'approved', reject: 'rejected', escalate: 'escalated',
};
const WORKFLOW_ACTIONS: Record<CaseStatus, CaseAction[]> = {
  pending: ['start_review', 'escalate'],
  in_review: ['escalate'],
  escalated: [],
  approved: [],
  rejected: [],
};
const DECISION_RISKS: Record<Role, RiskLevel[]> = {
  analyst: [], senior_analyst: ['low', 'medium'], compliance_manager: RISKS,
};
const NOTE = 'Fictional review evidence verified.';
const FIXTURE_TIME = '2020-01-01T00:00:00.000Z';
const HASH = /^[0-9a-f]{64}$/;

interface CaseView {
  id: string;
  status: CaseStatus;
  assignedTo: string | null;
  updatedAt: string;
  allowedActions: CaseAction[];
  audit: AuditEvent[];
}

interface Policy {
  version: number;
  requireApprovalNote: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

interface PolicyEvent {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  action: 'policy_updated';
  createdAt: string;
  reason: string;
  previousState: Policy;
  newState: Policy;
  prevHash: string;
  hash: string;
}

let db: Db;
let app: ReturnType<typeof createApp>;
let nextCase: number;

function addCase(status: CaseStatus = 'pending', risk: RiskLevel = 'low'): string {
  const id = `fictional-${++nextCase}`;
  db.prepare(`INSERT INTO customers (id, full_name, date_of_birth, nationality, country_of_residence,
    occupation, email, account_opened_at, expected_monthly_volume_usd, source_of_funds,
    id_document_type, id_document_verified, address_verified, pep_flag, sanctions_hit, adverse_media_hits)
    VALUES (?, 'Fictional Customer', '1990-01-01', 'US', 'US', 'teacher', ?, '2020-01-01',
    1000, 'salary', 'passport', 1, 1, 0, 0, 0)`).run(`${id}-customer`, `${id}@example.invalid`);
  db.prepare(`INSERT INTO cases (id, reference, customer_id, status, risk_level, risk_score,
    assigned_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, `REF-${id}`, `${id}-customer`, status, risk,
    { low: 10, medium: 40, high: 70 }[risk],
    ACTORS.senior_analyst.id, FIXTURE_TIME, FIXTURE_TIME,
  );
  return id;
}

function expectedActions(role: Role, risk: RiskLevel, status: CaseStatus): CaseAction[] {
  const decisions: CaseAction[] = status !== 'approved' && status !== 'rejected'
    && DECISION_RISKS[role].includes(risk) ? ['approve', 'reject'] : [];
  return [...WORKFLOW_ACTIONS[status], ...decisions].sort();
}

function act(id: string, role: Role, body: object) {
  return request(app).post(`/api/cases/${id}/actions`).set('x-analyst-id', ACTORS[role].id).send(body);
}

async function readCase(id: string): Promise<CaseView> {
  const res = await request(app).get(`/api/cases/${id}`)
    .set('x-analyst-id', ACTORS.senior_analyst.id).expect(200);
  return res.body as CaseView;
}

async function readAudit(id: string): Promise<AuditEvent[]> {
  const res = await request(app).get(`/api/cases/${id}/audit`)
    .set('x-analyst-id', ACTORS.senior_analyst.id).expect(200);
  return res.body as AuditEvent[];
}

async function expectCaseUnchanged(id: string, before: CaseView): Promise<void> {
  expect(await readCase(id)).toEqual(before);
  expect(await readAudit(id)).toEqual(before.audit);
}

async function readPolicy(role: Role = 'senior_analyst'): Promise<Policy> {
  const res = await request(app).get('/api/policy').set('x-analyst-id', ACTORS[role].id).expect(200);
  return res.body as Policy;
}

async function readPolicyAudit(): Promise<PolicyEvent[]> {
  const res = await request(app).get('/api/policy/audit')
    .set('x-analyst-id', ACTORS.senior_analyst.id).expect(200);
  return res.body as PolicyEvent[];
}

function updatePolicy(body: object, role: Role = 'compliance_manager') {
  return request(app).put('/api/policy').set('x-analyst-id', ACTORS[role].id).send(body);
}

async function setNotePolicy(requireApprovalNote: boolean): Promise<void> {
  const previous = await readPolicy();
  await updatePolicy({ version: previous.version, requireApprovalNote, reason: NOTE }).expect(200);
}

function expectTimeWithin(value: string, start: number): void {
  expect(typeof value).toBe('string');
  expect(Date.parse(value)).toBeGreaterThanOrEqual(start);
  expect(Date.parse(value)).toBeLessThanOrEqual(Date.now());
}

beforeEach(() => {
  db = openDb(':memory:');
  for (const actor of Object.values(ACTORS)) {
    db.prepare('INSERT INTO analysts (id, name, role) VALUES (?, ?, ?)').run(
      actor.id, actor.name, actor.role,
    );
  }
  app = createApp(db);
  nextCase = 0;
});

afterEach(() => {
  db.close();
});

describe('identity at every sensitive HTTP endpoint', () => {
  const endpoints = [
    ['get', '/api/me'],
    ['get', '/api/analysts'],
    ['get', '/api/cases/stats'],
    ['get', '/api/cases'],
    ['get', '/api/cases/fictional-1'],
    ['get', '/api/cases/fictional-1/risk-explanation'],
    ['get', '/api/cases/fictional-1/audit'],
    ['post', '/api/cases/fictional-1/actions'],
    ['get', '/api/policy'],
    ['put', '/api/policy'],
    ['get', '/api/policy/audit'],
  ] as const;

  it('allows anonymous health checks', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  describe.each(['missing', 'unknown'] as const)('%s identity', (identity) => {
    it.each(endpoints)('%s %s returns 401 without leaking or mutating data', async (method, path) => {
      const id = addCase();
      const before = await readCase(id);
      const policyBefore = method === 'put'
        ? { policy: await readPolicy(), audit: await readPolicyAudit() } : undefined;
      const req = request(app)[method](path).set('x-role', 'compliance_manager');
      if (identity === 'unknown') req.set('x-analyst-id', 'not-in-database');
      if (method === 'post') req.send({ action: 'start_review' });
      if (method === 'put') req.send({ version: 1, requireApprovalNote: false, reason: NOTE });
      const res = await req;
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) });
      await expectCaseUnchanged(id, before);
      if (policyBefore) {
        expect(await readPolicy()).toEqual(policyBefore.policy);
        expect(await readPolicyAudit()).toEqual(policyBefore.audit);
      }
    });
  });

  it.each(ROLES)('allows %s to read sensitive resources using a known identity', async (role) => {
    addCase();
    for (const [method, path] of endpoints) {
      if (method === 'get') {
        await request(app).get(path).set('x-analyst-id', ACTORS[role].id).expect(200);
      }
    }
    const me = await request(app).get('/api/me').set('x-analyst-id', ACTORS[role].id).expect(200);
    expect(me.body).toEqual(ACTORS[role]);
  });

  it('resolves promotions and demotions from the database on each request', async () => {
    const identity = ACTORS.analyst.id;
    for (const role of ['analyst', 'senior_analyst', 'compliance_manager', 'analyst'] as const) {
      db.prepare('UPDATE analysts SET role = ?, name = ? WHERE id = ?')
        .run(role, `Fictional ${role}`, identity);
      const me = await request(app).get('/api/me').set('x-analyst-id', identity).expect(200);
      expect(me.body).toEqual({ id: identity, name: `Fictional ${role}`, role });
      for (const risk of ['low', 'high'] as const) {
        const id = addCase('pending', risk);
        const detail = await request(app).get(`/api/cases/${id}`).set('x-analyst-id', identity).expect(200);
        expect(detail.body.allowedActions.sort()).toEqual(expectedActions(role, risk, 'pending'));
        const before = await readCase(id);
        const res = await act(id, 'analyst', { action: 'approve', note: NOTE })
          .set('x-role', 'compliance_manager');
        if (DECISION_RISKS[role].includes(risk)) {
          expect(res.status).toBe(200);
          expect(res.body.audit[0]).toMatchObject({ actorId: identity, actorName: `Fictional ${role}` });
        } else {
          expect(res.status).toBe(403);
          await expectCaseUnchanged(id, before);
        }
      }
    }
  });
});

describe.each(ROLES)('%s case authorization', (role) => {
  describe.each(RISKS)('%s risk', (risk) => {
    describe.each(STATUSES)('%s status', (status) => {
      it('advertises exactly the allowed actions', async () => {
        const id = addCase(status, risk);
        const res = await request(app).get(`/api/cases/${id}`)
          .set('x-analyst-id', ACTORS[role].id).expect(200);
        expect(res.body.allowedActions.sort()).toEqual(expectedActions(role, risk, status));
      });

      it.each(ACTIONS)('%s enforces role, risk and status without partial writes', async (action) => {
        const id = addCase(status, risk);
        const before = await readCase(id);
        const started = Date.now();
        const res = await act(id, role, { action, note: NOTE });
        if (!expectedActions(role, risk, status).includes(action)) {
          const invalidTransition = status === 'approved' || status === 'rejected'
            || (action === 'start_review' && status !== 'pending')
            || (action === 'escalate' && status === 'escalated');
          expect(res.status).toBe(invalidTransition ? 409 : 403);
          expect(res.body.error.code).toBe(invalidTransition ? 'INVALID_TRANSITION' : 'FORBIDDEN');
          await expectCaseUnchanged(id, before);
          return;
        }
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id, status: TARGETS[action], assignedTo: ACTORS[role].id });
        expect(res.body.allowedActions.sort()).toEqual(expectedActions(role, risk, TARGETS[action]));
        const after = await readCase(id);
        expect(after.status).toBe(TARGETS[action]);
        expect(after.assignedTo).toBe(ACTORS[role].id);
        expect(after.updatedAt).not.toBe(before.updatedAt);
        expectTimeWithin(after.updatedAt, started);
        const audit = await readAudit(id);
        expect(audit).toHaveLength(before.audit.length + 1);
        expect(audit.slice(0, -1)).toEqual(before.audit);
        expect(audit).toEqual(res.body.audit);
        expect(after.audit).toEqual(audit);
        const event = audit[audit.length - 1]!;
        expect(event).toMatchObject({
          id: expect.any(String), caseId: id, actorId: ACTORS[role].id, actorName: ACTORS[role].name,
          action, fromStatus: status, toStatus: TARGETS[action], note: NOTE,
          createdAt: after.updatedAt, prevHash: expect.stringMatching(HASH), hash: expect.stringMatching(HASH),
        });
        expectTimeWithin(event.createdAt, started);
      });
    });
  });
});

describe('strict action bodies and append-only case audit', () => {
  const invalidBodies = [
    ['missing action', {}],
    ['unknown action', { action: 'reopen' }],
    ['non-string note', { action: 'approve', note: 42 }],
    ...Object.entries({
      actorId: ACTORS.compliance_manager.id,
      actorName: 'Forged Actor',
      actorRole: 'compliance_manager',
      actor: ACTORS.compliance_manager,
      role: 'compliance_manager',
      riskLevel: 'low',
      riskScore: 0,
      status: 'pending',
      fromStatus: 'pending',
      toStatus: 'approved',
      assignedTo: ACTORS.compliance_manager.id,
      updatedAt: FIXTURE_TIME,
      caseId: 'another-case',
    }).map(([field, value]) => [field, { action: 'approve', note: NOTE, [field]: value }] as const),
  ] as const;

  it.each(invalidBodies)('rejects %s without changing case or history', async (_label, body) => {
    const id = addCase('pending', 'high');
    await act(id, 'analyst', { action: 'start_review' }).expect(200);
    const before = await readCase(id);
    await act(id, 'compliance_manager', body).expect(400);
    await expectCaseUnchanged(id, before);
  });

  it('does not honor x-role on a denied decision with existing audit history', async () => {
    const id = addCase('pending', 'high');
    await act(id, 'analyst', { action: 'start_review' }).expect(200);
    const before = await readCase(id);
    await act(id, 'senior_analyst', { action: 'reject', note: NOTE })
      .set('x-role', 'compliance_manager').expect(403);
    await expectCaseUnchanged(id, before);
  });

  it('appends server-derived events while preserving earlier case history', async () => {
    const id = addCase('pending', 'high');
    await act(id, 'analyst', { action: 'start_review' }).expect(200);
    const first = await readAudit(id);
    await act(id, 'senior_analyst', { action: 'escalate', note: NOTE }).expect(200);
    const second = await readAudit(id);
    expect(second).toHaveLength(2);
    expect(second.slice(0, 1)).toEqual(first);
    await act(id, 'compliance_manager', { action: 'approve', note: NOTE }).expect(200);
    const third = await readAudit(id);
    expect(third).toHaveLength(3);
    expect(third.slice(0, 2)).toEqual(second);
    for (const [index, event] of third.entries()) {
      expect(event.sequence).toBe(index + 1);
      expect(event.hash).toMatch(HASH);
      if (index > 0) expect(event.prevHash).toBe(third[index - 1]!.hash);
    }
    const before = await readCase(id);
    await act(id, 'compliance_manager', { action: 'reject', note: NOTE }).expect(409);
    await expectCaseUnchanged(id, before);
  });

  it.each(ROLES)('provides no case-audit mutation endpoints to %s', async (role) => {
    const id = addCase();
    await act(id, 'analyst', { action: 'start_review' }).expect(200);
    const before = await readCase(id);
    const eventId = before.audit[0]!.id;
    for (const path of [
      `/api/cases/${id}/audit`, `/api/cases/${id}/audit/${eventId}`,
      '/api/audit', `/api/audit/${eventId}`,
    ]) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(app)[method](path).set('x-analyst-id', ACTORS[role].id)
          .send({ action: 'approve', note: 'Forged audit entry', toStatus: 'approved' });
        expect([404, 405]).toContain(res.status);
        await expectCaseUnchanged(id, before);
      }
    }
  });
});

describe('versioned manager-only policy updates', () => {
  it('exposes the default policy and an empty audit to all roles', async () => {
    const initial = await readPolicy();
    expect(initial).toEqual({
      version: expect.any(Number), requireApprovalNote: true,
      updatedAt: expect.any(String), updatedBy: null,
    });
    expect(Number.isInteger(initial.version)).toBe(true);
    expect(Number.isFinite(Date.parse(initial.updatedAt))).toBe(true);
    for (const role of ROLES) expect(await readPolicy(role)).toEqual(initial);
    expect(await readPolicyAudit()).toEqual([]);
  });

  it('atomically exposes versioned state and linked audit snapshots with trimmed reasons', async () => {
    let previous = await readPolicy();
    let history = await readPolicyAudit();
    for (const reason of ['  1234567890  ', `  ${'r'.repeat(1000)}  `]) {
      const started = Date.now();
      const requireApprovalNote = !previous.requireApprovalNote;
      await updatePolicy({ version: previous.version, requireApprovalNote, reason }).expect(200);
      const current = await readPolicy();
      expect(current).toEqual({
        version: previous.version + 1, requireApprovalNote,
        updatedAt: expect.any(String), updatedBy: ACTORS.compliance_manager.id,
      });
      expectTimeWithin(current.updatedAt, started);
      const audit = await readPolicyAudit();
      expect(audit).toHaveLength(history.length + 1);
      expect(audit.slice(0, -1)).toEqual(history);
      const event = audit[audit.length - 1]!;
      expect(event).toMatchObject({
        id: expect.any(String),
        actorId: ACTORS.compliance_manager.id,
        actorName: ACTORS.compliance_manager.name,
        actorRole: 'compliance_manager',
        action: 'policy_updated',
        createdAt: current.updatedAt,
        reason: reason.trim(),
        previousState: previous,
        newState: current,
        prevHash: expect.stringMatching(HASH),
        hash: expect.stringMatching(HASH),
      });
      if (history.length) {
        expect(event.prevHash).toBe(history[history.length - 1]!.hash);
        expect(event.hash).not.toBe(history[history.length - 1]!.hash);
        expect(event.id).not.toBe(history[history.length - 1]!.id);
      }
      previous = current;
      history = audit;
    }
  });

  it.each(['analyst', 'senior_analyst'] as const)('denies %s policy writes despite x-role', async (role) => {
    await setNotePolicy(false);
    const before = await readPolicy();
    const audit = await readPolicyAudit();
    await updatePolicy({ version: before.version, requireApprovalNote: true, reason: NOTE }, role)
      .set('x-role', 'compliance_manager').expect(403);
    expect(await readPolicy()).toEqual(before);
    expect(await readPolicyAudit()).toEqual(audit);
  });

  it('rechecks the policy writer role and captures the current database identity', async () => {
    await setNotePolicy(false);
    const before = await readPolicy();
    const audit = await readPolicyAudit();
    db.prepare('UPDATE analysts SET role = ? WHERE id = ?')
      .run('senior_analyst', ACTORS.compliance_manager.id);
    const body = { version: before.version, requireApprovalNote: true, reason: NOTE };
    await updatePolicy(body).set('x-role', 'compliance_manager').expect(403);
    expect(await readPolicy()).toEqual(before);
    expect(await readPolicyAudit()).toEqual(audit);
    db.prepare('UPDATE analysts SET role = ?, name = ? WHERE id = ?')
      .run('compliance_manager', 'Renamed Fictional Manager', ACTORS.compliance_manager.id);
    await updatePolicy(body).expect(200);
    const updatedAudit = await readPolicyAudit();
    expect(updatedAudit).toHaveLength(audit.length + 1);
    expect(updatedAudit.slice(0, -1)).toEqual(audit);
    expect(updatedAudit[updatedAudit.length - 1]).toMatchObject({
      actorId: ACTORS.compliance_manager.id,
      actorName: 'Renamed Fictional Manager',
      actorRole: 'compliance_manager',
    });
  });

  it('returns 409 for a stale version and 400 for an unchanged setting without audit writes', async () => {
    const initial = await readPolicy();
    await setNotePolicy(false);
    const current = await readPolicy();
    const audit = await readPolicyAudit();
    await updatePolicy({ version: initial.version, requireApprovalNote: true, reason: NOTE }).expect(409);
    expect(await readPolicy()).toEqual(current);
    expect(await readPolicyAudit()).toEqual(audit);
    await updatePolicy({ version: current.version, requireApprovalNote: false, reason: NOTE }).expect(400);
    expect(await readPolicy()).toEqual(current);
    expect(await readPolicyAudit()).toEqual(audit);
  });

  const invalidPolicyFields: [string, unknown][] = [
    ['version', undefined], ['version', '1'], ['version', 1.5], ['version', null],
    ['requireApprovalNote', undefined], ['requireApprovalNote', 'false'], ['requireApprovalNote', null],
    ['reason', undefined], ['reason', null], ['reason', 1234567890], ['reason', ''],
    ['reason', '  123456789  '], ['reason', ' '.repeat(10)], ['reason', 'r'.repeat(1001)],
    ['actorId', ACTORS.compliance_manager.id], ['actorName', 'Forged Manager'],
    ['actorRole', 'compliance_manager'], ['role', 'compliance_manager'],
    ['updatedBy', 'forged-identity'], ['updatedAt', FIXTURE_TIME],
    ['riskLevel', 'low'], ['status', 'approved'],
  ];
  it.each(invalidPolicyFields)('rejects policy field %s = %j without writes', async (field, value) => {
    await setNotePolicy(false);
    const before = await readPolicy();
    const history = await readPolicyAudit();
    await updatePolicy({
      version: before.version, requireApprovalNote: true, reason: NOTE, [field]: value,
    }).expect(400);
    expect(await readPolicy()).toEqual(before);
    expect(await readPolicyAudit()).toEqual(history);
  });

  it.each(ROLES)('provides no policy-audit mutation endpoints to %s', async (role) => {
    await setNotePolicy(false);
    const before = await readPolicy();
    const audit = await readPolicyAudit();
    for (const path of ['/api/policy/audit', `/api/policy/audit/${audit[0]!.id}`]) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(app)[method](path).set('x-analyst-id', ACTORS[role].id)
          .send({ ...audit[0], reason: 'Forged policy history' });
        expect([404, 405]).toContain(res.status);
        expect(await readPolicy()).toEqual(before);
        expect(await readPolicyAudit()).toEqual(audit);
      }
    }
  });
});

describe.each([true, false])('requireApprovalNote = %s', (required) => {
  beforeEach(async () => {
    if (!required) await setNotePolicy(false);
  });

  const activeStatuses: CaseStatus[] = ['pending', 'in_review', 'escalated'];
  const permittedLowMedium = (['senior_analyst', 'compliance_manager'] as const).flatMap((role) =>
    (['low', 'medium'] as const).flatMap((risk) => activeStatuses.map((status) => ({ role, risk, status }))),
  );
  it.each(permittedLowMedium)('$role approves $risk $status without notes only when policy permits',
    async ({ role, risk, status }) => {
      const id = addCase(status, risk);
      const before = await readCase(id);
      const res = await act(id, role, { action: 'approve' });
      expect(res.status).toBe(required ? 400 : 200);
      if (required) {
        await expectCaseUnchanged(id, before);
      } else {
        expect(res.body.status).toBe('approved');
        expect((await readAudit(id))[0]).toMatchObject({
          action: 'approve', actorId: ACTORS[role].id, fromStatus: status, toStatus: 'approved',
        });
      }
    });

  const noteCases = [
    { label: 'missing', note: undefined, valid: false },
    { label: 'empty', note: '', valid: false },
    { label: 'nine trimmed characters', note: ' 123456789 ', valid: false },
    { label: 'whitespace', note: ' '.repeat(10), valid: false },
    { label: '1001 characters', note: 'n'.repeat(1001), valid: false },
    { label: '10 characters', note: 'n'.repeat(10), valid: true },
    { label: '1000 characters', note: 'n'.repeat(1000), valid: true },
  ];
  const requiredNoteScenarios: { action: CaseAction; status: CaseStatus; risk: RiskLevel }[] = [
    ...activeStatuses.map((status) => ({ action: 'approve' as const, status, risk: 'high' as const })),
    { action: 'reject', status: 'pending', risk: 'low' },
    { action: 'reject', status: 'escalated', risk: 'medium' },
    { action: 'escalate', status: 'pending', risk: 'high' },
    { action: 'escalate', status: 'in_review', risk: 'low' },
    ...(required ? [{ action: 'approve' as const, status: 'in_review' as const, risk: 'low' as const }] : []),
  ];
  describe.each(requiredNoteScenarios)('$action $risk $status always requires a bounded note',
    ({ action, status, risk }) => {
      it.each(noteCases)('$label', async ({ note, valid }) => {
        const id = addCase(status, risk);
        const before = await readCase(id);
        const res = await act(id, 'compliance_manager', { action, ...(note === undefined ? {} : { note }) });
        expect(res.status).toBe(valid ? 200 : 400);
        if (!valid) await expectCaseUnchanged(id, before);
        else expect(res.body.status).toBe(TARGETS[action]);
      });
    });

  const deniedDecisions = [
    ...RISKS.map((risk) => ({ role: 'analyst' as const, risk })),
    { role: 'senior_analyst' as const, risk: 'high' as const },
  ].flatMap((boundary) => activeStatuses.flatMap((status) =>
    (['approve', 'reject'] as const).map((action) => ({ ...boundary, status, action })),
  ));
  it.each(deniedDecisions)('policy cannot authorize $role to $action $risk $status',
    async ({ role, risk, status, action }) => {
      const id = addCase(status, risk);
      const before = await readCase(id);
      const detail = await request(app).get(`/api/cases/${id}`)
        .set('x-analyst-id', ACTORS[role].id).expect(200);
      expect(detail.body.allowedActions.sort()).toEqual(expectedActions(role, risk, status));
      await act(id, role, { action, note: NOTE }).expect(403);
      await expectCaseUnchanged(id, before);
    });
});
