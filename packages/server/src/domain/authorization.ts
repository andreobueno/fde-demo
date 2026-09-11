import type { AnalystRole } from '../types.js';

export type Permission =
  | 'cases:read'
  | 'audit:read'
  | 'cases:review'
  | 'cases:escalate'
  | 'cases:decide_low_medium'
  | 'cases:decide_high'
  | 'policy:read'
  | 'policy:manage';

const COMMON_PERMISSIONS: readonly Permission[] = [
  'cases:read',
  'audit:read',
  'cases:review',
  'cases:escalate',
  'policy:read',
];

export function permissionsFor(role: AnalystRole): Permission[] {
  switch (role) {
    case 'analyst':
      return [...COMMON_PERMISSIONS];
    case 'senior_analyst':
      return [...COMMON_PERMISSIONS, 'cases:decide_low_medium'];
    case 'compliance_manager':
      return [...COMMON_PERMISSIONS, 'cases:decide_low_medium', 'cases:decide_high', 'policy:manage'];
    default:
      return [];
  }
}

export function hasPermission(role: AnalystRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
