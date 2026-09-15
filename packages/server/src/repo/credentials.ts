import type { Db } from '../db.js';
import { hashPassword, type ScryptParameters } from '../domain/password.js';
import type { AnalystRole } from '../types.js';

export interface AnalystCredential {
  analystId: string;
  email: string;
  passwordHash: string;
}

interface CredentialRow {
  analyst_id: string;
  email: string;
  password_hash: string;
}

interface DemoCredentialRow {
  analyst_id: string;
  name: string;
  role: AnalystRole;
  email: string;
}

export interface DemoCredential {
  analystId: string;
  name: string;
  role: AnalystRole;
  email: string;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toCredential(row: CredentialRow): AnalystCredential {
  return { analystId: row.analyst_id, email: row.email, passwordHash: row.password_hash };
}

export function findCredentialByEmail(db: Db, email: string): AnalystCredential | null {
  const row = db
    .prepare<[string], CredentialRow>('SELECT * FROM analyst_credentials WHERE email = ?')
    .get(normaliseEmail(email));
  return row ? toCredential(row) : null;
}

export function findCredentialByAnalyst(db: Db, analystId: string): AnalystCredential | null {
  const row = db
    .prepare<[string], CredentialRow>('SELECT * FROM analyst_credentials WHERE analyst_id = ?')
    .get(analystId);
  return row ? toCredential(row) : null;
}

export function listDemoCredentials(db: Db): DemoCredential[] {
  return db.prepare(`
    SELECT
      analysts.id AS analyst_id,
      analysts.name,
      analysts.role,
      analyst_credentials.email
    FROM analyst_credentials
    JOIN analysts ON analysts.id = analyst_credentials.analyst_id
    ORDER BY analysts.id
  `).all().map((row) => {
    const credential = row as DemoCredentialRow;
    return {
      analystId: credential.analyst_id,
      name: credential.name,
      role: credential.role,
      email: credential.email,
    };
  });
}

export function setAnalystPassword(
  db: Db,
  analystId: string,
  email: string,
  password: string,
  options: { now?: Date; parameters?: ScryptParameters } = {},
): AnalystCredential {
  const normalised = normaliseEmail(email);
  const passwordHash = options.parameters
    ? hashPassword(password, options.parameters)
    : hashPassword(password);
  const updatedAt = (options.now ?? new Date()).toISOString();
  return db.transaction(() => {
    const analyst = db.prepare('SELECT id FROM analysts WHERE id = ?').get(analystId);
    if (!analyst) throw new Error('Unknown analyst.');
    db.prepare(`
      INSERT INTO analyst_credentials (analyst_id, email, password_hash, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (analyst_id) DO UPDATE SET
        email = excluded.email,
        password_hash = excluded.password_hash,
        updated_at = excluded.updated_at
    `).run(analystId, normalised, passwordHash, updatedAt);
    return { analystId, email: normalised, passwordHash };
  }).immediate();
}
