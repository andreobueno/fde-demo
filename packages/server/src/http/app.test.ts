import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { openDb, type Db } from '../db.js';
import { createApp } from './app.js';
import { computeEventHash, GENESIS_HASH, verifyChain } from '../domain/audit.js';
import type { CaseStatus } from '../types.js';

let db: Db;
let app: ReturnType<typeof createApp>;

function addCase(id: string, opts: {
  status?: CaseStatus; riskLevel?: 'low' | 'medium' | 'high'; riskScore?: number;
  fullName?: string; email?: string; reference?: string;
} = {}): void {
  const status = opts.status ?? 'pending';
  const riskLevel = opts.riskLevel ?? 'low';
  db.prepare(`INSERT INTO customers (id, full_name, date_of_birth, nationality, country_of_residence,
    occupation, email, account_opened_at, expected_monthly_volume_usd, source_of_funds,
    id_document_type, id_document_verified, address_verified, pep_flag, sanctions_hit, adverse_media_hits)
    VALUES (?, ?, '1990-01-01', 'US', 'US', 'teacher', ?, '2020-01-01',
    1000, 'salary', 'passport', 1, 1, 0, 0, 0)`).run(
    `${id}-cust`, opts.fullName ?? `Name ${id}`, opts.email ?? `${id}@example.com`,
  );
  db.prepare(`INSERT INTO cases (id, reference, customer_id, status, risk_level, risk_score,
    assigned_to, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    id, opts.reference ?? `REF-${id}`, `${id}-cust`, status, riskLevel, opts.riskScore ?? 10,
    `2026-01-0${id.endsWith('1') ? '1' : '2'}T00:00:00Z`, '2026-01-02T00:00:00Z',
  );
  const fields = {
    caseId: id, sequence: 1, actorId: 'ana-001', action: 'CASE_CREATED',
    fromStatus: null, toStatus: 'pending' as CaseStatus, note: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
  db.prepare(`INSERT INTO audit_events (id, case_id, sequence, actor_id, actor_name, action,
    from_status, to_status, note, created_at, prev_hash, hash)
    VALUES (?, ?, 1, 'ana-001', 'Marta Ellison', 'CASE_CREATED', NULL, 'pending', NULL,
    '2026-01-01T00:00:00Z', ?, ?)`).run(
    `evt-${id}-1`, id, GENESIS_HASH, computeEventHash(GENESIS_HASH, fields),
  );
}

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare('INSERT INTO analysts (id, name, role) VALUES (?, ?, ?)').run(
    'ana-001', 'Marta Ellison', 'senior_analyst',
  );
  db.prepare('INSERT INTO analysts (id, name, role) VALUES (?, ?, ?)').run(
    'ana-003', 'Grete Lindholm', 'analyst',
  );
  addCase('c-1', { status: 'pending', riskLevel: 'high', riskScore: 70, fullName: 'Alice High', email: 'alice@x.com', reference: 'KYC-0001' });
  addCase('c-2', { status: 'in_review', riskLevel: 'medium', riskScore: 40, fullName: 'Bob Mid', email: 'bob@x.com', reference: 'KYC-0002' });
  addCase('c-3', { status: 'approved', riskLevel: 'low', riskScore: 5, fullName: 'Cara Low', email: 'cara@y.com', reference: 'KYC-0003' });
  app = createApp(db);
});

describe('HTTP API', () => {
  it('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('GET /api/cases filters by status and riskLevel', async () => {
    const res = await request(app).get('/api/cases?status=pending,in_review&riskLevel=high');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe('c-1');
  });

  it('GET /api/cases q matches reference/name/email case-insensitively', async () => {
    const byName = await request(app).get('/api/cases?q=alice');
    expect(byName.body.total).toBe(1);
    const byRef = await request(app).get('/api/cases?q=kyc-0002');
    expect(byRef.body.items[0].id).toBe('c-2');
    const byEmail = await request(app).get('/api/cases?q=CARA@y.com');
    expect(byEmail.body.total).toBe(1);
  });

  it('GET /api/cases paginates and sorts', async () => {
    const res = await request(app).get('/api/cases?sort=riskScore&order=desc&page=2&pageSize=2');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('c-3');
    const p1 = await request(app).get('/api/cases?sort=riskScore&order=desc&page=1&pageSize=2');
    expect(p1.body.items.map((i: { id: string }) => i.id)).toEqual(['c-1', 'c-2']);
  });

  it('GET /api/cases sorts by reference ascending', async () => {
    const res = await request(app).get('/api/cases?sort=reference&order=asc');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { reference: string }) => i.reference)).toEqual([
      'KYC-0001', 'KYC-0002', 'KYC-0003',
    ]);
  });

  it('GET /api/cases sorts by customer name case-insensitively', async () => {
    const res = await request(app).get('/api/cases?sort=customer&order=desc');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['c-3', 'c-2', 'c-1']);
  });

  it('GET /api/cases sorts by assignedTo with unassigned last', async () => {
    db.prepare("UPDATE cases SET assigned_to = 'ana-003' WHERE id = 'c-2'").run();
    db.prepare("UPDATE cases SET assigned_to = 'ana-001' WHERE id = 'c-3'").run();
    const asc = await request(app).get('/api/cases?sort=assignedTo&order=asc');
    expect(asc.status).toBe(200);
    // Grete Lindholm < Marta Ellison, then unassigned
    expect(asc.body.items.map((i: { id: string }) => i.id)).toEqual(['c-2', 'c-3', 'c-1']);
    const desc = await request(app).get('/api/cases?sort=assignedTo&order=desc');
    expect(desc.body.items.map((i: { id: string }) => i.id)).toEqual(['c-3', 'c-2', 'c-1']);
  });

  it('GET /api/cases sort=bogus → 400', async () => {
    const res = await request(app).get('/api/cases?sort=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/cases validates bad params → 400', async () => {
    const res = await request(app).get('/api/cases?pageSize=101');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const res2 = await request(app).get('/api/cases?status=bogus');
    expect(res2.status).toBe(400);
  });

  it('GET /api/cases/:id returns detail with customer/signals/audit/allowedActions', async () => {
    const res = await request(app).get('/api/cases/c-1');
    expect(res.status).toBe(200);
    expect(res.body.customer.email).toBe('alice@x.com');
    expect(res.body.allowedActions).toContain('start_review');
    expect(res.body.audit).toHaveLength(1);
  });

  it('GET /api/cases/:id unknown → 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/cases/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/cases/:id/risk-explanation returns explanation', async () => {
    const res = await request(app).get('/api/cases/c-1/risk-explanation');
    expect(res.status).toBe(200);
    expect(res.body.caseId).toBe('c-1');
    expect(res.body.thresholds).toEqual({ medium: 30, high: 60 });
  });

  it('GET /api/cases/:id/audit returns events ascending', async () => {
    const res = await request(app).get('/api/cases/c-1/audit');
    expect(res.status).toBe(200);
    expect(res.body[0].sequence).toBe(1);
  });

  it('POST /api/cases/:id/actions without x-analyst-id → 401', async () => {
    const res = await request(app).post('/api/cases/c-1/actions').send({ action: 'approve' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/cases/:id/actions with unknown analyst → 401', async () => {
    const res = await request(app)
      .post('/api/cases/c-1/actions')
      .set('x-analyst-id', 'ana-999')
      .send({ action: 'approve' });
    expect(res.status).toBe(401);
  });

  it('POST approve returns updated case with audit + allowedActions', async () => {
    const res = await request(app)
      .post('/api/cases/c-1/actions')
      .set('x-analyst-id', 'ana-001')
      .send({ action: 'approve', note: 'high risk approval with justification' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.assignedTo).toBe('ana-001');
    expect(res.body.allowedActions).toEqual([]);
    expect(res.body.audit).toHaveLength(2);
    expect(res.body.audit[1].action).toBe('approve');
    expect(verifyChain(res.body.audit)).toBe(true);
  });

  it('POST reject without note → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/cases/c-2/actions')
      .set('x-analyst-id', 'ana-001')
      .send({ action: 'reject' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST start_review on approved case → 409 INVALID_TRANSITION', async () => {
    const res = await request(app)
      .post('/api/cases/c-3/actions')
      .set('x-analyst-id', 'ana-001')
      .send({ action: 'start_review' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('POST invalid body → 400', async () => {
    const res = await request(app)
      .post('/api/cases/c-1/actions')
      .set('x-analyst-id', 'ana-001')
      .send({ action: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('GET /api/me defaults to ana-001 on reads', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('ana-001');
  });

  it('GET /api/cases/stats returns counts', async () => {
    const res = await request(app).get('/api/cases/stats');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.byStatus.pending).toBe(1);
    expect(res.body.byRiskLevel.high).toBe(1);
  });
});
