import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db.js';
import { permissionsFor } from '../domain/authorization.js';
import { REFUND_ACTORS, refundFixtureContext } from '../refundFixtures.js';
import { listAuthEvents } from '../repo/authEvents.js';
import { setAnalystPassword } from '../repo/credentials.js';
import { SESSION_IDLE_TIMEOUT_MS, SESSION_LIFETIME_MS } from '../repo/sessions.js';
import { MAX_FAILED_ATTEMPTS } from '../services/authService.js';
import { createApp } from './app.js';

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
  db.close();
});

describe('POST /api/auth/sign-in', () => {
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
    for (const body of [{}, { email: 'not-an-email', password: PASSWORD }, { email: emailFor(analyst.id) }]) {
      const response = await request(app).post('/api/auth/sign-in').send(body);
      expect(response.status).toBe(400);
    }
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

  it('serves the current role from the database without a new sign-in', async () => {
    const token = await tokenFor(analyst.id);
    db.prepare('UPDATE analysts SET role = ? WHERE id = ?').run('compliance_manager', analyst.id);
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.role).toBe('compliance_manager');
    expect(me.body.permissions).toEqual(permissionsFor('compliance_manager'));
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
});
