import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db.js';
import { permissionsFor } from '../domain/authorization.js';
import { addRefund, REFUND_ACTORS, refundFixtureContext } from '../refundFixtures.js';
import { listAuthEvents } from '../repo/authEvents.js';
import { setAnalystPassword } from '../repo/credentials.js';
import { issueAccessToken } from '../repo/accessTokens.js';
import {
  createSession,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_LIFETIME_MS,
} from '../repo/sessions.js';
import { MAX_FAILED_ATTEMPTS } from '../services/authService.js';
import { createApp } from './app.js';
import { MAX_SOURCE_FAILURES } from './auth.js';
import { seedDemoLogins } from '../seedLogins.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const PASSWORD = 'demo-password-2026';
const WRONG_PASSWORD = 'demo-password-2025';
const analyst = REFUND_ACTORS.analyst;
const manager = REFUND_ACTORS.compliance_manager;
const fast = { cost: 1024, blockSize: 8, parallelization: 1 };
let db: Db;
let app: ReturnType<typeof createApp>;

const signIn = (email: string, password: string) =>
  request(app).post('/api/auth/sign-in').send({ email, password });

const emailFor = (id: string) => `${id}@northwind-demo.example`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = openDb(':memory:');
  refundFixtureContext(db);
  for (const id of [analyst.id, manager.id]) {
    setAnalystPassword(db, id, emailFor(id), PASSWORD, { parameters: fast });
  }
  app = createApp(db, { localAuth: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  db.close();
});

describe('POST /api/auth/sign-in', () => {
  it('lists actual retained demo credentials for the role picker', async () => {
    db.prepare('UPDATE analysts SET name = ? WHERE id = ?')
      .run('Renamed Manager', manager.id);
    setAnalystPassword(
      db,
      manager.id,
      'renamed.manager@northwind-demo.example',
      PASSWORD,
      { parameters: fast },
    );

    const response = await request(app).get('/api/auth/demo-users');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'analyst',
        name: analyst.name,
        email: emailFor(analyst.id),
      },
      {
        id: 'admin',
        name: 'Renamed Manager',
        email: 'renamed.manager@northwind-demo.example',
      },
    ]);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain('scrypt');
  });

  it('returns the identity, permissions and a session that authorizes requests', async () => {
    const response = await signIn(emailFor(manager.id), PASSWORD);
    expect(response.status).toBe(201);
    expect(response.body.analyst).toEqual({
      id: manager.id,
      name: manager.name,
      role: 'compliance_manager',
      permissions: permissionsFor('compliance_manager'),
    });
    expect(response.body.session).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: new Date(NOW.getTime() + SESSION_LIFETIME_MS).toISOString(),
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    });

    const me = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${response.body.session.token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(manager.id);
  });

  it('never returns the password or its stored hash', async () => {
    const response = await signIn(emailFor(manager.id), PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain('scrypt');
    expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain(response.body.session.token);
    expect(JSON.stringify(listAuthEvents(db))).not.toContain(response.body.session.token);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('accepts the email in any case and with surrounding spaces', async () => {
    const response = await signIn(`  ${emailFor(analyst.id).toUpperCase()}  `, PASSWORD);
    expect(response.status).toBe(201);
  });

  it('gives the same answer for an unknown email and an incorrect password', async () => {
    const unknown = await signIn('nobody@northwind-demo.example', PASSWORD);
    const wrong = await signIn(emailFor(analyst.id), WRONG_PASSWORD);
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' },
    });
  });

  it('rejects malformed sign-in payloads', async () => {
    for (const body of [
      {}, { email: 'not-an-email', password: PASSWORD }, { email: emailFor(analyst.id) },
      { email: emailFor(analyst.id), password: PASSWORD, role: 'compliance_manager' },
    ]) {
      const response = await request(app).post('/api/auth/sign-in').send(body);
      expect(response.status).toBe(400);
    }
  });

  it('limits password attempts across different accounts from the same source', async () => {
    for (let attempt = 0; attempt < MAX_SOURCE_FAILURES; attempt++) {
      await signIn(`unknown-${attempt}@northwind-demo.example`, WRONG_PASSWORD);
    }
    expect((await signIn(emailFor(manager.id), PASSWORD)).status).toBe(429);
    expect(listAuthEvents(db).some((event) => event.reason === 'source_limit')).toBe(true);
  });

  it('rolls back session creation when its audit write fails', async () => {
    db.exec(`CREATE TRIGGER fail_sign_in BEFORE INSERT ON auth_events
      WHEN NEW.event = 'sign_in_succeeded'
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    expect((await signIn(emailFor(analyst.id), PASSWORD)).status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('throttles repeated failures for one email and keeps other identities usable', async () => {
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      expect((await signIn(emailFor(analyst.id), WRONG_PASSWORD)).status).toBe(401);
    }
    const throttled = await signIn(emailFor(analyst.id), PASSWORD);
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect((await signIn(emailFor(manager.id), PASSWORD)).status).toBe(201);

    vi.setSystemTime(new Date(NOW.getTime() + 16 * 60 * 1000));
    expect((await signIn(emailFor(analyst.id), PASSWORD)).status).toBe(201);
  });

  it('records append-only authentication events without the password', async () => {
    await signIn(emailFor(analyst.id), WRONG_PASSWORD);
    await signIn(emailFor(analyst.id), PASSWORD);
    const events = listAuthEvents(db);
    expect(events.map((event) => event.event).sort()).toEqual(['sign_in_failed', 'sign_in_succeeded']);
    expect(events.every((event) => event.analystId === analyst.id)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(PASSWORD);
    expect(() => db.prepare('DELETE FROM auth_events').run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE auth_events SET event = 'sign_out'").run()).toThrow(/append-only/);
  });
});

describe('sessions', () => {
  const tokenFor = async (id: string): Promise<string> =>
    (await signIn(emailFor(id), PASSWORD)).body.session.token;

  it('keeps parallel sessions independent, including for the same identity', async () => {
    const [first, second, third] = [
      await tokenFor(analyst.id),
      await tokenFor(manager.id),
      await tokenFor(analyst.id),
    ];
    const identity = async (token: string) =>
      (await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).body.id;
    expect([await identity(first), await identity(second), await identity(third)]).toEqual([
      analyst.id, manager.id, analyst.id,
    ]);

    await request(app).post('/api/auth/sign-out').set('Authorization', `Bearer ${first}`);
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${first}`)).status).toBe(401);
    expect(await identity(second)).toBe(manager.id);
    expect(await identity(third)).toBe(analyst.id);
  });

  it('purges abandoned expired and idle sessions when creating a new session', async () => {
    const staleTime = new Date(NOW.getTime() - SESSION_IDLE_TIMEOUT_MS - 1);
    createSession(db, analyst.id, { now: staleTime });
    createSession(db, manager.id, { now: staleTime });
    db.prepare('UPDATE sessions SET expires_at = ? WHERE analyst_id = ?')
      .run(new Date(NOW.getTime() - 1).toISOString(), analyst.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 2 });

    await tokenFor(analyst.id);

    expect(db.prepare('SELECT analyst_id FROM sessions').all()).toEqual([
      { analyst_id: analyst.id },
    ]);
  });

  it('serves the current role from the database without a new sign-in', async () => {
    const token = await tokenFor(analyst.id);
    db.prepare('UPDATE analysts SET role = ? WHERE id = ?').run('compliance_manager', analyst.id);
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.role).toBe('compliance_manager');
    expect(me.body.permissions).toEqual(permissionsFor('compliance_manager'));
  });

  it('enforces distinct roles and attributes mutations to the authenticated session', async () => {
    const refund = addRefund(db, { riskLevel: 'high' });
    const junior = await tokenFor(analyst.id);
    const elevated = await tokenFor(manager.id);
    const decide = (token: string) => request(app)
      .post(`/api/refunds/${refund.id}/actions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve', note: 'Fictional evidence verified.' });
    expect((await decide(junior)).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get()).toEqual({ n: 1 });
    expect((await request(app).get('/api/me')
      .set('Authorization', `Bearer ${junior}`).set('x-analyst-id', manager.id)).status).toBe(403);
    expect((await decide(elevated)).status).toBe(200);
    expect(db.prepare('SELECT actor_id FROM audit_events ORDER BY sequence DESC LIMIT 1').get())
      .toEqual({ actor_id: manager.id });
  });

  it('immediately applies role demotion to an existing session', async () => {
    const refund = addRefund(db, { riskLevel: 'high' });
    const token = await tokenFor(manager.id);
    db.prepare('UPDATE analysts SET role = ? WHERE id = ?').run('analyst', manager.id);
    expect((await request(app).post(`/api/refunds/${refund.id}/actions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve', note: 'Fictional evidence verified.' })).status).toBe(403);
  });

  it('expires idle sessions and extends active ones', async () => {
    const idle = await tokenFor(analyst.id);
    const active = await tokenFor(manager.id);
    vi.setSystemTime(new Date(NOW.getTime() + SESSION_IDLE_TIMEOUT_MS - 1000));
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${active}`)).status).toBe(200);

    vi.setSystemTime(new Date(NOW.getTime() + SESSION_IDLE_TIMEOUT_MS + 1000));
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${idle}`)).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${active}`)).status).toBe(200);
  });

  it('ends sessions at the absolute lifetime even while in use', async () => {
    const token = await tokenFor(analyst.id);
    for (let elapsed = SESSION_IDLE_TIMEOUT_MS / 2; elapsed < SESSION_LIFETIME_MS; elapsed += SESSION_IDLE_TIMEOUT_MS / 2) {
      vi.setSystemTime(new Date(NOW.getTime() + elapsed));
      expect((await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    }
    vi.setSystemTime(new Date(NOW.getTime() + SESSION_LIFETIME_MS));
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('rejects unknown, malformed and signed-out credentials', async () => {
    const token = await tokenFor(analyst.id);
    await request(app).post('/api/auth/sign-out').set('Authorization', `Bearer ${token}`);
    for (const header of [`Bearer ${token}`, 'Bearer short', `Basic ${token}`, '']) {
      const response = await request(app).get('/api/cases').set('Authorization', header);
      expect(response.status).toBe(401);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('signs out idempotently and accepts an unusable credential without failing', async () => {
    const token = await tokenFor(analyst.id);
    for (const header of [`Bearer ${token}`, `Bearer ${token}`, 'Bearer nonsense']) {
      expect((await request(app).post('/api/auth/sign-out').set('Authorization', header)).status).toBe(204);
    }
    expect(listAuthEvents(db).filter((event) => event.event === 'sign_out')).toHaveLength(1);
  });

  it('rolls back logout if its audit cannot be recorded', async () => {
    const token = await tokenFor(analyst.id);
    db.exec(`CREATE TRIGGER fail_sign_out BEFORE INSERT ON auth_events
      WHEN NEW.event = 'sign_out'
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    expect((await request(app).post('/api/auth/sign-out')
      .set('Authorization', `Bearer ${token}`)).status).toBe(500);
    expect((await request(app).get('/api/me')
      .set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });
});

describe('local authentication boundary', () => {
  it('disables local login and existing demo sessions by default, retaining automation tokens', async () => {
    const session = (await signIn(emailFor(analyst.id), PASSWORD)).body.session.token;
    const automation = issueAccessToken(db, analyst.id).token;
    app = createApp(db, { localAuth: false });
    const disabled = await signIn(emailFor(analyst.id), PASSWORD);
    expect(disabled.status).toBe(404);
    expect(disabled.body.error.code).toBe('LOCAL_AUTH_DISABLED');
    expect((await request(app).get('/api/auth/demo-users')).status).toBe(404);
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${session}`)).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${automation}`)).status).toBe(200);
  });

  it('refuses local auth and demo credential seeding in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createApp(db, { localAuth: true })).toThrow(/not permitted in production/);
    expect(() => seedDemoLogins(db)).toThrow(/cannot be seeded in production/);
    expect(() => createApp(db, { localAuth: false })).not.toThrow();
  });
});
