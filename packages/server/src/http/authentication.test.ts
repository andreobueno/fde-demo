import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db.js';
import { permissionsFor } from '../domain/authorization.js';
import { addRefund, refundFixtureContext, REFUND_ACTORS, REFUND_NOTE } from '../refundFixtures.js';
import { authenticateAccessToken, issueAccessToken, revokeAccessTokens } from '../repo/accessTokens.js';
import { createApp } from './app.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const manager = REFUND_ACTORS.compliance_manager;
const analyst = REFUND_ACTORS.analyst;
const endpoints: Array<{ method: 'get' | 'put' | 'post'; path: string; body?: object }> = [
  { method: 'get', path: '/api/me' },
  { method: 'get', path: '/api/analysts' },
  { method: 'get', path: '/api/cases' },
  { method: 'get', path: '/api/cases/stats' },
  { method: 'get', path: '/api/cases/auth-case' },
  { method: 'get', path: '/api/cases/auth-case/audit' },
  { method: 'get', path: '/api/cases/auth-case/risk-explanation' },
  { method: 'get', path: '/api/policy' },
  { method: 'get', path: '/api/policy/audit' },
  { method: 'get', path: '/api/risk-policy' },
  { method: 'get', path: '/api/risk-policy/history' },
  { method: 'get', path: '/api/refunds' },
  { method: 'get', path: '/api/refunds/stats' },
  { method: 'get', path: '/api/refunds/refund-test' },
  { method: 'get', path: '/api/refunds/refund-test/audit' },
  { method: 'post', path: '/api/cases/auth-case/actions', body: { action: 'approve', note: REFUND_NOTE } },
  { method: 'post', path: '/api/refunds/refund-test/actions', body: { action: 'approve', note: REFUND_NOTE } },
  { method: 'put', path: '/api/policy', body: { version: 1, requireApprovalNote: false, reason: REFUND_NOTE } },
  { method: 'put', path: '/api/risk-policy', body: { weights: { PEP: 50 } } },
];
const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } };
let db: Db;
let app: ReturnType<typeof createApp>;
let analystToken: string;
let managerToken: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = openDb(':memory:');
  refundFixtureContext(db);
  addRefund(db, { riskLevel: 'high' });
  db.prepare(`INSERT INTO cases (id, reference, customer_id, status, risk_level, risk_score,
    assigned_to, created_at, updated_at) VALUES
    ('auth-case', 'AUTH-CASE', 'cus-001', 'pending', 'high', 70, NULL, ?, ?)`)
    .run(NOW.toISOString(), NOW.toISOString());
  analystToken = issueAccessToken(db, analyst.id).token;
  managerToken = issueAccessToken(db, manager.id).token;
  app = createApp(db);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  db.close();
});

function records() {
  return {
    cases: db.prepare('SELECT * FROM cases ORDER BY id').all(),
    refunds: db.prepare('SELECT * FROM refunds ORDER BY id').all(),
    audit: db.prepare('SELECT * FROM audit_events ORDER BY id').all(),
    signals: db.prepare('SELECT * FROM risk_signals ORDER BY id').all(),
    thresholds: db.prepare('SELECT * FROM case_risk_thresholds ORDER BY case_id').all(),
    reviewPolicy: db.prepare('SELECT * FROM review_policy').all(),
    policyAudit: db.prepare('SELECT * FROM policy_audit_events ORDER BY id').all(),
    riskPolicy: db.prepare('SELECT * FROM risk_policy ORDER BY key').all(),
    riskHistory: db.prepare('SELECT * FROM risk_policy_changes ORDER BY id').all(),
    changes: db.prepare('SELECT total_changes() AS count').get(),
  };
}

describe('bearer authentication at the API boundary', () => {
  it.each(endpoints)('rejects a bare forged manager on $method $path without writes', async ({ method, path, body }) => {
    const before = records();
    const response = await request(app)[method](path).set('x-analyst-id', manager.id)
      .set('x-role', manager.role).send(body);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    expect(records()).toEqual(before);
  });

  it.each(endpoints)('rejects a valid analyst token with manager ID on $method $path', async ({ method, path, body }) => {
    const before = records();
    const response = await request(app)[method](path).set('Authorization', `Bearer ${analystToken}`)
      .set('x-analyst-id', manager.id).send(body);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(records()).toEqual(before);
  });

  it.each(endpoints)('authorizes a manager credential with default createApp on $method $path', async ({ method, path, body }) => {
    const response = await request(app)[method](path).set('Authorization', `Bearer ${managerToken}`).send(body);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(managerToken);
    expect(JSON.stringify(response.body)).not.toContain('token_hash');
  });

  it('returns only the current analyst shape and treats matching identity as an optional guard', async () => {
    for (const expectedIdentity of [undefined, analyst.id]) {
      const req = request(app).get('/api/me').set('Authorization', `Bearer ${analystToken}`);
      if (expectedIdentity) req.set('x-analyst-id', expectedIdentity);
      const response = await req.expect(200);
      expect(response.body).toEqual({ ...analyst, permissions: permissionsFor(analyst.role) });
    }
    const actors = await request(app).get('/api/analysts').set('Authorization', `Bearer ${analystToken}`).expect(200);
    expect(actors.body).toEqual(Object.values(REFUND_ACTORS).sort((a, b) => a.id.localeCompare(b.id)));
  });

  it.each(['', 'unknown', analyst.id])('rejects manager credentials with a different expected identity: %s', async (id) => {
    const before = records();
    await request(app).post('/api/cases/auth-case/actions').set('Authorization', `Bearer ${managerToken}`)
      .set('x-analyst-id', id).send({ action: 'approve', note: REFUND_NOTE }).expect(403);
    expect(records()).toEqual(before);
  });

  it.each([
    'missing', 'unknown', 'ID as token', 'basic', 'empty', 'extra whitespace', 'padded',
    'noncanonical', 'expired', 'revoked', 'cookie', 'query', 'deleted actor',
  ])('returns generic 401 for %s credentials on reads and mutations', async (kind) => {
    let credential: string | undefined;
    switch (kind) {
      case 'unknown': credential = `Bearer ${randomBytes(32).toString('base64url')}`; break;
      case 'ID as token': credential = `Bearer ${manager.id}`; break;
      case 'basic': credential = `Basic ${managerToken}`; break;
      case 'empty': credential = 'Bearer'; break;
      case 'extra whitespace': credential = `Bearer  ${managerToken}`; break;
      case 'padded': credential = `Bearer ${managerToken}=`; break;
      case 'noncanonical': credential = `Bearer ${'A'.repeat(42)}B`; break;
      case 'expired':
        credential = `Bearer ${issueAccessToken(db, manager.id, {
          now: new Date(NOW.getTime() - 1000), expiresInMs: 1000,
        }).token}`;
        break;
      case 'revoked':
        revokeAccessTokens(db, manager.id);
        credential = `Bearer ${managerToken}`;
        break;
      case 'deleted actor':
        db.prepare('DELETE FROM analysts WHERE id = ?').run(manager.id);
        credential = `Bearer ${managerToken}`;
        break;
    }
    const before = records();
    for (const { method, path, body } of endpoints) {
      const req = request(app)[method](path).set('x-analyst-id', manager.id).send(body);
      if (credential) req.set('Authorization', credential);
      if (kind === 'cookie') req.set('Cookie', `token=${managerToken}; analystId=${manager.id}`);
      if (kind === 'query') req.query({ token: managerToken });
      const response = await req.expect(401);
      expect(response.body).toEqual(unauthorized);
      expect(response.text).not.toContain(managerToken);
    }
    expect(records()).toEqual(before);
  });

  it('reloads revoked roles and current names without revoking the credential', async () => {
    db.prepare('UPDATE analysts SET role = ?, name = ? WHERE id = ?')
      .run('analyst', 'Current Analyst Name', manager.id);
    const response = await request(app).get('/api/me').set('Authorization', `Bearer ${managerToken}`).expect(200);
    expect(response.body).toEqual({
      id: manager.id, name: 'Current Analyst Name', role: 'analyst', permissions: permissionsFor('analyst'),
    });
    const before = records();
    for (const { method, path, body } of endpoints.filter(({ method }) => method !== 'get')) {
      await request(app)[method](path).set('Authorization', `Bearer ${managerToken}`)
        .set('x-analyst-id', manager.id).set('x-role', 'compliance_manager').send(body).expect(403);
    }
    expect(records()).toEqual(before);
    expect(authenticateAccessToken(db, managerToken)?.role).toBe('analyst');
  });

  it('expires credentials exactly at the default eight-hour deadline', async () => {
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 60 * 60 * 1000 - 1));
    await request(app).get('/api/me').set('Authorization', `Bearer ${analystToken}`).expect(200);
    vi.setSystemTime(new Date(NOW.getTime() + 8 * 60 * 60 * 1000));
    const response = await request(app).get('/api/me').set('Authorization', `Bearer ${analystToken}`).expect(401);
    expect(response.body).toEqual(unauthorized);
  });

  it('protects unknown paths and methods, and authenticates before parsing request bodies', async () => {
    await request(app).get('/api/unknown').expect(401);
    await request(app).head('/api/cases').expect(401);
    const response = await request(app).put('/api/policy').set('Content-Type', 'application/json')
      .send('{invalid JSON').expect(401);
    expect(response.body).toEqual(unauthorized);
    await request(app).get('/api/health').set('Authorization', 'Bearer invalid').expect(200);
  });

  it('allows header-only CORS preflight while still authenticating the actual request', async () => {
    const before = records();
    const origin = 'http://localhost:5173';
    const preflight = await request(app).options('/api/policy').set('Origin', origin)
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'authorization,content-type').expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization');
    expect(preflight.text).toBe('');
    await request(app).put('/api/policy').set('Origin', origin)
      .send({ version: 1, requireApprovalNote: false, reason: REFUND_NOTE }).expect(401);
    expect(records()).toEqual(before);
    const deniedOrigin = await request(app).options('/api/policy').set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'PUT').expect(204);
    expect(deniedOrigin.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not enable header impersonation from the former demo environment opt-in', async () => {
    vi.stubEnv('KYC_TRUST_ANALYST_HEADER', '1');
    await request(createApp(db)).get('/api/me').set('x-analyst-id', manager.id).expect(401);
    await request(createApp(db)).get('/api/me').set('Authorization', `Bearer ${managerToken}`).expect(200);
  });
});
