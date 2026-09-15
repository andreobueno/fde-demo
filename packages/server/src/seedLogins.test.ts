import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db.js';
import { addRefund, REFUND_ACTORS, refundFixtureContext } from './refundFixtures.js';
import { authenticateAccessToken, issueAccessToken } from './repo/accessTokens.js';
import { listAuthEvents } from './repo/authEvents.js';
import { authenticateSession } from './repo/sessions.js';
import { findCredentialByAnalyst } from './repo/credentials.js';
import { DEMO_PASSWORD, demoEmail, seedDemoLogins } from './seedLogins.js';
import { signIn, SignInThrottle } from './services/authService.js';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  refundFixtureContext(db);
  addRefund(db);
});
afterEach(() => db.close());

describe('local demo credential provisioning', () => {
  it('provisions existing fictional identities without changing business data or automation tokens', () => {
    const actor = REFUND_ACTORS.analyst;
    const token = issueAccessToken(db, actor.id).token;
    const analysts = db.prepare('SELECT * FROM analysts').all();
    const refunds = db.prepare('SELECT * FROM refunds').all();
    const audit = db.prepare('SELECT * FROM audit_events').all();
    const logins = seedDemoLogins(db);
    expect(logins).toHaveLength(3);
    expect(db.prepare('SELECT * FROM analysts').all()).toEqual(analysts);
    expect(db.prepare('SELECT * FROM refunds').all()).toEqual(refunds);
    expect(db.prepare('SELECT * FROM audit_events').all()).toEqual(audit);
    expect(authenticateAccessToken(db, token)?.id).toBe(actor.id);
    const credential = findCredentialByAnalyst(db, actor.id);
    expect(credential?.passwordHash).not.toContain(DEMO_PASSWORD);
    expect(signIn(db, new SignInThrottle(), {
      email: demoEmail(actor.name), password: DEMO_PASSWORD,
    }).analyst.id).toBe(actor.id);
  });

  it('resets passwords and invalidates browser sessions while retaining authentication history', () => {
    seedDemoLogins(db);
    const actor = REFUND_ACTORS.analyst;
    const firstHash = findCredentialByAnalyst(db, actor.id)?.passwordHash;
    const { session } = signIn(db, new SignInThrottle(), {
      email: demoEmail(actor.name), password: DEMO_PASSWORD,
    });
    const events = listAuthEvents(db);
    seedDemoLogins(db);
    expect(findCredentialByAnalyst(db, actor.id)?.passwordHash).not.toBe(firstHash);
    expect(authenticateSession(db, session.token)).toBeNull();
    expect(listAuthEvents(db)).toEqual(events);
    expect(db.prepare('SELECT COUNT(*) AS n FROM analyst_credentials').get()).toEqual({ n: 3 });
  });

  it('reassigns unique emails when retained analysts exchange names', () => {
    seedDemoLogins(db);
    const first = REFUND_ACTORS.senior_analyst;
    const second = REFUND_ACTORS.analyst;
    const rename = db.prepare('UPDATE analysts SET name = ? WHERE id = ?');
    rename.run(second.name, first.id);
    rename.run(first.name, second.id);

    const logins = seedDemoLogins(db);

    expect(findCredentialByAnalyst(db, first.id)?.email).toBe(demoEmail(second.name));
    expect(findCredentialByAnalyst(db, second.id)?.email).toBe(demoEmail(first.name));
    for (const login of logins) {
      expect(signIn(db, new SignInThrottle(), {
        email: login.email, password: DEMO_PASSWORD,
      }).analyst).toMatchObject({ id: login.analystId, role: login.role });
    }
  });

  it('restores credentials and sessions when replacement fails midway', () => {
    seedDemoLogins(db);
    const actor = REFUND_ACTORS.senior_analyst;
    const { session } = signIn(db, new SignInThrottle(), {
      email: demoEmail(actor.name), password: DEMO_PASSWORD,
    });
    const credentials = db.prepare('SELECT * FROM analyst_credentials ORDER BY analyst_id').all();
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY token_hash').all();
    const events = listAuthEvents(db);
    db.exec(`CREATE TRIGGER fail_seed_credentials BEFORE INSERT ON analyst_credentials
      WHEN NEW.analyst_id = 'ana-003'
      BEGIN SELECT RAISE(ABORT, 'simulated credential replacement failure'); END;`);

    expect(() => seedDemoLogins(db, { password: 'replacement-password-2026' }))
      .toThrow(/simulated credential replacement failure/);

    expect(db.prepare('SELECT * FROM analyst_credentials ORDER BY analyst_id').all()).toEqual(credentials);
    expect(db.prepare('SELECT * FROM sessions ORDER BY token_hash').all()).toEqual(sessions);
    expect(listAuthEvents(db)).toEqual(events);
    expect(authenticateSession(db, session.token)?.id).toBe(actor.id);
    expect(signIn(db, new SignInThrottle(), {
      email: demoEmail(actor.name), password: DEMO_PASSWORD,
    }).analyst.id).toBe(actor.id);
  });

  it('assigns stable unique emails when fictional analysts share a name', () => {
    db.prepare('UPDATE analysts SET name = ? WHERE id IN (?, ?)')
      .run(
        'Alex Kim',
        REFUND_ACTORS.analyst.id,
        REFUND_ACTORS.compliance_manager.id,
      );

    const first = seedDemoLogins(db);
    const duplicateEmails = first
      .filter(({ name }) => name === 'Alex Kim')
      .map(({ email }) => email);

    expect(new Set(first.map(({ email }) => email)).size).toBe(first.length);
    expect(duplicateEmails).toHaveLength(2);
    expect(duplicateEmails).not.toContain(demoEmail('Alex Kim'));
    expect(seedDemoLogins(db).map(({ email }) => email)).toEqual(
      first.map(({ email }) => email),
    );
  });
});
