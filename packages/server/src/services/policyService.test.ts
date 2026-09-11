import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db.js';
import { GENESIS_HASH } from '../domain/audit.js';
import { computePolicyEventHash } from '../domain/policy.js';
import { getPolicy, listPolicyAuditEvents } from '../repo/policy.js';
import { updatePolicy } from './policyService.js';

let db: Db;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare('INSERT INTO analysts VALUES (?, ?, ?)').run('manager', 'Fictional Manager', 'compliance_manager');
  db.prepare('INSERT INTO analysts VALUES (?, ?, ?)').run('analyst', 'Fictional Analyst', 'analyst');
});
afterEach(() => db.close());

describe('policy transactions', () => {
  it('records server-derived identity and both policy snapshots in a verifiable chain', () => {
    const initial = getPolicy(db);
    const first = updatePolicy(db, 'manager', {
      version: initial.version, requireApprovalNote: false, reason: '  Updated after policy review.  ',
    });
    const second = updatePolicy(db, 'manager', {
      version: first.version, requireApprovalNote: true, reason: 'Require documented evidence again.',
    });
    const events = listPolicyAuditEvents(db);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      actorId: 'manager', actorName: 'Fictional Manager', actorRole: 'compliance_manager',
      action: 'policy_updated', reason: 'Updated after policy review.',
      previousState: initial, newState: first, prevHash: GENESIS_HASH,
    });
    expect(events[1]).toMatchObject({
      previousState: first, newState: second, prevHash: events[0]?.hash,
    });
    for (const event of events) {
      expect(event.hash).toBe(computePolicyEventHash(event));
      expect(event.createdAt).toBe(event.newState.updatedAt);
      expect(Number.isNaN(Date.parse(event.createdAt))).toBe(false);
    }
  });

  it('rolls back policy version and settings if audit storage fails', () => {
    const before = getPolicy(db);
    db.exec(`CREATE TRIGGER fail_policy_audit BEFORE INSERT ON policy_audit_events
      BEGIN SELECT RAISE(ABORT, 'simulated audit outage'); END;`);
    expect(() => updatePolicy(db, 'manager', {
      version: before.version, requireApprovalNote: false, reason: 'Changing approval documentation.',
    })).toThrow(/simulated audit outage/);
    expect(getPolicy(db)).toEqual(before);
    expect(listPolicyAuditEvents(db)).toEqual([]);
  });

  it('rejects stale versions and invalid updates without history changes', () => {
    const input = { version: 1, requireApprovalNote: false, reason: 'Changing approval documentation.' };
    updatePolicy(db, 'manager', input);
    const before = getPolicy(db);
    const events = listPolicyAuditEvents(db);
    expect(() => updatePolicy(db, 'manager', input))
      .toThrowError(expect.objectContaining({ status: 409 }));
    expect(() => updatePolicy(db, 'manager', { ...input, version: 2, requireApprovalNote: true, reason: '   ' }))
      .toThrowError(expect.objectContaining({ status: 400 }));
    expect(getPolicy(db)).toEqual(before);
    expect(listPolicyAuditEvents(db)).toEqual(events);
  });

  it('enforces authorization even when the service is called directly', () => {
    const input = { version: 1, requireApprovalNote: false, reason: 'Changing approval documentation.' };
    expect(() => updatePolicy(db, 'analyst', input))
      .toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => updatePolicy(db, 'missing', input))
      .toThrowError(expect.objectContaining({ status: 401 }));
    expect(getPolicy(db).version).toBe(1);
    expect(listPolicyAuditEvents(db)).toEqual([]);
  });

  it('protects policy audit events against SQL update, delete and replace', () => {
    updatePolicy(db, 'manager', { version: 1, requireApprovalNote: false, reason: 'Changing approval documentation.' });
    const before = listPolicyAuditEvents(db);
    for (const statement of [
      "UPDATE policy_audit_events SET reason = 'forged'",
      'DELETE FROM policy_audit_events',
      'INSERT OR REPLACE INTO policy_audit_events SELECT * FROM policy_audit_events',
    ]) {
      expect(() => db.exec(statement)).toThrow(/append-only/);
      expect(listPolicyAuditEvents(db)).toEqual(before);
    }
  });
});
