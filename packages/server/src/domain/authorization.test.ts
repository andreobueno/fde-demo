import { describe, expect, it } from 'vitest';
import { hasPermission, permissionsFor } from './authorization.js';
import type { Permission } from './authorization.js';
import type { AnalystRole } from '../types.js';

const PERMISSIONS: Permission[] = [
  'cases:read',
  'audit:read',
  'cases:review',
  'cases:escalate',
  'cases:decide_low_medium',
  'cases:decide_high',
  'policy:read',
  'policy:manage',
];
const EXPECTED: Record<AnalystRole, Permission[]> = {
  analyst: ['cases:read', 'audit:read', 'cases:review', 'cases:escalate', 'policy:read'],
  senior_analyst: [
    'cases:read', 'audit:read', 'cases:review', 'cases:escalate', 'cases:decide_low_medium', 'policy:read',
  ],
  compliance_manager: PERMISSIONS,
};

describe.each(['analyst', 'senior_analyst', 'compliance_manager'] as const)('%s permissions', (role) => {
  it('returns exactly the granted permissions', () => {
    expect(permissionsFor(role).sort()).toEqual([...EXPECTED[role]].sort());
  });

  it.each(PERMISSIONS)('checks %s', (permission) => {
    expect(hasPermission(role, permission)).toBe(EXPECTED[role].includes(permission));
  });

  it('does not allow callers to mutate subsequent grants', () => {
    const permissions = permissionsFor(role);
    permissions.splice(0, permissions.length, 'policy:manage');
    expect(permissionsFor(role).sort()).toEqual([...EXPECTED[role]].sort());
    expect(hasPermission(role, 'cases:read')).toBe(true);
    expect(hasPermission(role, 'policy:manage')).toBe(role === 'compliance_manager');
  });

  it('rejects an unknown runtime permission', () => {
    expect(hasPermission(role, 'cases:reopen' as Permission)).toBe(false);
  });
});

describe('unknown runtime roles', () => {
  it.each([
    'unknown', '', 'manager', 'ANALYST', '__proto__', 'constructor', 'toString',
    null, undefined, {}, ['compliance_manager'], Symbol('compliance_manager'),
  ])('grants no permissions to %s', (runtimeRole) => {
    const role = runtimeRole as AnalystRole;
    expect(permissionsFor(role)).toEqual([]);
    for (const permission of PERMISSIONS) {
      expect(hasPermission(role, permission)).toBe(false);
    }
  });
});
