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
});
