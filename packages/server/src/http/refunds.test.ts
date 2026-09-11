import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { openDb, type Db } from '../db.js';
import type { Refund, RefundAuditEvent, RefundDetail } from '../types.js';
import { createApp } from './app.js';
import * as authorization from '../domain/authorization.js';
import { REFUND_SORTS } from '../domain/refunds.js';
import { getRefund } from '../repo/refunds.js';
import { listRefundAuditEvents } from '../repo/audit.js';
import { addRefund, refundFixtureContext, REFUND_ACTORS, REFUND_NOTE, REFUND_TIME } from '../refundFixtures.js';
import { seedRefunds } from '../seedRefunds.js';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb(':memory:');
  refundFixtureContext(db);
  app = createApp(db);
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });
const roles = ['analyst', 'senior_analyst', 'compliance_manager'] as const;
const actions = ['approve', 'reject'] as const;
const paths = ['/api/refunds', '/api/refunds/stats', '/api/refunds/refund-test', '/api/refunds/refund-test/audit'];
const manager = REFUND_ACTORS.compliance_manager;
const senior = REFUND_ACTORS.senior_analyst;

describe('refund identity and protected reads', () => {
  it.each([undefined, 'unknown'])('rejects identity %s on every route', async (identity) => {
    for (const path of paths) {
      const req = request(app).get(path);
      if (identity) req.set('x-analyst-id', identity);
      await req.expect(401);
    }
    const req = request(app).post('/api/refunds/refund-test/actions').send({ action: 'approve', note: REFUND_NOTE });
    if (identity) req.set('x-analyst-id', identity);
    await req.expect(401);
  });
  it.each(roles)('allows %s to read list, stats, detail and audit', async (role) => {
    addRefund(db);
    for (const path of paths) await request(app).get(path).set('x-analyst-id', REFUND_ACTORS[role].id).expect(200);
    const detail = await request(app).get('/api/refunds/refund-test').set('x-analyst-id', REFUND_ACTORS[role].id);
    expect(detail.body.customer).toEqual({
      id: 'cus-001', fullName: 'Avery Fiction', email: 'avery.fiction@example-mail.com',
    });
    expect(detail.body).toMatchObject({ approvalNoteRequired: true, currency: 'USD' });
    expect(detail.body.customer).not.toHaveProperty('dateOfBirth');
    expect(detail.body.audit[0]).toHaveProperty('refundId', 'refund-test');
    expect(detail.body.audit[0]).not.toHaveProperty('caseId');
  });
  it.each(['refunds:read', 'audit:read'] as const)('requires %s independently on detail and audit', async (denied) => {
    addRefund(db);
    const original = authorization.hasPermission;
    vi.spyOn(authorization, 'hasPermission').mockImplementation((role, permission) =>
      permission === denied ? false : original(role, permission),
    );
    for (const path of paths) {
      const expected = denied === 'refunds:read' || path.includes('refund-test') ? 403 : 200;
      await request(app).get(path).set('x-analyst-id', manager.id).expect(expected);
    }
    await request(app).post('/api/refunds/refund-test/actions').set('x-analyst-id', manager.id)
      .send({ action: 'approve', note: REFUND_NOTE }).expect(403);
  });
  it('returns 404 on missing refund reads and decisions', async () => {
    for (const path of ['/api/refunds/missing', '/api/refunds/missing/audit']) {
      await request(app).get(path).set('x-analyst-id', manager.id).expect(404);
    }
    await request(app).post('/api/refunds/missing/actions').set('x-analyst-id', manager.id)
      .send({ action: 'approve', note: REFUND_NOTE }).expect(404);
  });
});

describe('refund HTTP decisions', () => {
  const matrix = roles.flatMap((role) => (['low', 'medium', 'high'] as const).flatMap((riskLevel) =>
    [99999, 100000, 500000, 500001].flatMap((amountCents) =>
      actions.map((action) => ({ role, riskLevel, amountCents, action })),
    ),
  ));
  it.each(matrix)('$role $action $riskLevel $amountCents matches allowedActions', async (input) => {
    addRefund(db, { riskLevel: input.riskLevel, amountCents: input.amountCents });
    const identity = REFUND_ACTORS[input.role].id;
    const before = await request(app).get('/api/refunds/refund-test').set('x-analyst-id', identity).expect(200);
    const permitted = input.role === 'compliance_manager' ||
      (input.role === 'senior_analyst' && input.riskLevel !== 'high' && input.amountCents <= 500000);
    expect(before.body.allowedActions).toEqual(permitted ? ['approve', 'reject'] : []);
    const result = await request(app).post('/api/refunds/refund-test/actions')
      .set('x-analyst-id', identity).set('x-role', 'compliance_manager')
      .send({ action: input.action, note: `  ${REFUND_NOTE}  ` }).expect(permitted ? 200 : 403);
    if (!permitted) {
      expect(getRefund(db, 'refund-test')?.status).toBe('pending');
      expect(listRefundAuditEvents(db, 'refund-test')).toEqual(before.body.audit);
    } else {
      const detail = result.body as RefundDetail;
      expect(detail.status).toBe(input.action === 'approve' ? 'approved' : 'rejected');
      expect(detail.allowedActions).toEqual([]);
      expect(detail.audit).toHaveLength(2);
      expect(detail.audit[1]).toMatchObject({ actorId: identity, note: REFUND_NOTE, action: input.action });
      for (const action of actions) {
        await request(app).post('/api/refunds/refund-test/actions').set('x-analyst-id', identity)
          .send({ action, note: REFUND_NOTE }).expect(409);
      }
      expect(listRefundAuditEvents(db, 'refund-test')).toEqual(detail.audit);
    }
  });
  const invalid: [string, unknown][] = [
    ['action', 'pay'], ['action', 'start_review'], ['action', null], ['action', undefined],
    ['note', undefined], ['note', null], ['note', 1234567890], ['note', ' '.repeat(10)],
    ['note', ' 123456789 '], ['note', 'n'.repeat(1001)], ['note', []],
    ['actorId', manager.id], ['actorName', 'Forged'], ['actor', manager],
    ['role', 'compliance_manager'], ['status', 'approved'], ['amountCents', 1],
    ['riskLevel', 'low'], ['currency', 'USD'], ['refundId', 'other'],
  ];
  it.each(invalid)('rejects field %s=%j without writes', async (field, value) => {
    addRefund(db);
    const history = listRefundAuditEvents(db, 'refund-test');
    await request(app).post('/api/refunds/refund-test/actions').set('x-analyst-id', manager.id)
      .send({ action: 'approve', note: REFUND_NOTE, [field]: value }).expect(400);
    expect(getRefund(db, 'refund-test')?.status).toBe('pending');
    expect(listRefundAuditEvents(db, 'refund-test')).toEqual(history);
  });
  it.each(actions)('%s accepts trimmed 10 and 1000 character notes', async (action) => {
    for (const length of [10, 1000]) {
      addRefund(db, { id: `refund-${length}`, reference: `RFD-${length}` });
      const result = await request(app).post(`/api/refunds/refund-${length}/actions`).set('x-analyst-id', senior.id)
        .send({ action, note: `  ${'n'.repeat(length)}  ` }).expect(200);
      expect(result.body.audit[1].note).toBe('n'.repeat(length));
    }
  });
  it.each(roles)('offers no history mutation endpoints to %s', async (role) => {
    addRefund(db);
    const history = listRefundAuditEvents(db, 'refund-test');
    for (const path of ['/api/refunds/refund-test/audit', '/api/refunds/refund-test/audit/creation-refund-test']) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        await request(app)[method](path).set('x-analyst-id', REFUND_ACTORS[role].id).send(history[0]).expect(404);
      }
    }
    expect(listRefundAuditEvents(db, 'refund-test')).toEqual(history);
  });
});

describe('refund queue HTTP contract', () => {
  beforeEach(() => { seedRefunds(db, new Date(REFUND_TIME)); });
  async function queue(query = ''): Promise<{ items: Refund[]; total: number; page: number; pageSize: number }> {
    const res = await request(app).get(`/api/refunds${query}`).set('x-analyst-id', senior.id).expect(200);
    return res.body as { items: Refund[]; total: number; page: number; pageSize: number };
  }
  it('returns frozen defaults and stable paging with total before pagination', async () => {
    const all = await queue();
    expect(all).toMatchObject({ total: 18, page: 1, pageSize: 25 });
    expect(all.items).toHaveLength(18);
    const first = await queue('?pageSize=5');
    const second = await queue('?pageSize=5&page=2');
    expect(first.items).toEqual(all.items.slice(0, 5));
    expect(second.items).toEqual(all.items.slice(5, 10));
    expect(second).toMatchObject({ total: 18, page: 2, pageSize: 5 });
    expect((await queue('?page=100')).items).toEqual([]);
  });
  it.each([
    ['under_1000', 99999, 99999],
    ['1000_to_5000', 100000, 500000],
    ['over_5000', 500001, 500001],
  ])('filters inclusive amount band %s', async (band, min, max) => {
    const result = await queue(`?status=pending&amountBand=${band}`);
    expect(result.total).toBe(band === '1000_to_5000' ? 6 : 3);
    expect(result.items.every((refund) => refund.amountCents >= Number(min) && refund.amountCents <= Number(max))).toBe(true);
  });
  it('combines comma filters and text search without changing dataset stats', async () => {
    const before = await request(app).get('/api/refunds/stats').set('x-analyst-id', senior.id);
    const result = await queue('?status=pending,approved&riskLevel=low,medium&q=Avery&amountBand=1000_to_5000');
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((refund) =>
      ['pending', 'approved'].includes(refund.status) && ['low', 'medium'].includes(refund.riskLevel)
      && refund.customer.fullName === 'Avery Fiction' && refund.amountCents >= 100000 && refund.amountCents <= 500000,
    )).toBe(true);
    const after = await request(app).get('/api/refunds/stats').set('x-analyst-id', senior.id);
    expect(after.body).toEqual(before.body);
  });
  it.each([
    ['RFD-DEMO-001', 1], ['txn-demo-001', 1], ['Avery Fiction', 9], ['zelda.example@', 9],
    ["' OR 1=1 --", 0], ['%', 0], ['_', 0], ['\\', 0],
  ])('searches literal %s', async (term, count) => {
    expect((await queue(`?q=${encodeURIComponent(term)}`)).total).toBe(count);
  });
  it.each(REFUND_SORTS)('sorts %s both directions with stable ascending ID ties', async (sort) => {
    db.exec("UPDATE refunds SET created_at = '2026-09-01T00:00:00.000Z'");
    const all = (await queue()).items;
    function value(refund: Refund): string | number {
      switch (sort) {
        case 'customer': return refund.customer.fullName.toLowerCase();
        case 'riskLevel': return { low: 0, medium: 1, high: 2 }[refund.riskLevel];
        default: return refund[sort];
      }
    }
    for (const order of ['asc', 'desc']) {
      const expected = [...all].sort((a, b) => {
        const av = value(a), bv = value(b);
        const comparison = av < bv ? -1 : av > bv ? 1 : 0;
        return comparison * (order === 'asc' ? 1 : -1) || a.id.localeCompare(b.id);
      });
      expect((await queue(`?sort=${sort}&order=${order}`)).items.map((refund) => refund.id))
        .toEqual(expected.map((refund) => refund.id));
    }
  });
  it.each([
    'q=' + 'x'.repeat(101), 'status=in_review', 'riskLevel=extreme', 'amountBand=5000',
    'sort=amount_cents', 'sort=createdAt;DROP TABLE refunds', 'order=sideways',
    'page=0', 'page=-1', 'page=1.5', 'pageSize=0', 'pageSize=101', 'pageSize=1.5',
    'q[]=a&q[]=b', 'status[x]=pending', 'unexpected=1', 'page=9007199254740992',
  ])('rejects invalid query %s', async (query) => {
    await request(app).get(`/api/refunds?${query}`).set('x-analyst-id', senior.id).expect(400);
  });
  it('returns the same audit array through detail and the audit endpoint', async () => {
    const detail = await request(app).get('/api/refunds/refund-013').set('x-analyst-id', manager.id);
    const audit = await request(app).get('/api/refunds/refund-013/audit').set('x-analyst-id', manager.id);
    expect(audit.body as RefundAuditEvent[]).toEqual((detail.body as RefundDetail).audit);
  });
});
