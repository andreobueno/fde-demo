import { randomUUID } from 'node:crypto';
import { openDb } from './db.js';
import { schemaSql } from './schema.js';
import { computeRisk } from './domain/risk.js';
import { computeEventHash, GENESIS_HASH } from './domain/audit.js';
import type { Analyst, CaseStatus, Customer } from './types.js';

// Deterministic PRNG: mulberry32 seeded from the seed string.
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(hashSeed('kyc-demo-2026'));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;

const FIRST_NAMES = [
  'Avery', 'Bianca', 'Callum', 'Dalia', 'Emeka', 'Farrah', 'Gideon', 'Hana', 'Idris', 'Jolene',
  'Kaspar', 'Leilani', 'Mateo', 'Nadia', 'Osman', 'Priya', 'Quentin', 'Rosa', 'Sven', 'Tamara',
  'Umar', 'Vera', 'Wendell', 'Ximena', 'Yusuf', 'Zelda', 'Amara', 'Boris', 'Celeste', 'Dmitri',
];
const LAST_NAMES = [
  'Alvarez', 'Bakker', 'Castellanos', 'Duval', 'Egilsson', 'Fontaine', 'Grigorescu', 'Holloway',
  'Ibrahim', 'Janssen', 'Kowalski', 'Lindqvist', 'Mbeki', 'Nakamura', 'Osei', 'Petrov', 'Quintero',
  'Ramachandran', 'Silva', 'Tanaka', 'Ueda', 'Vasquez', 'Whitfield', 'Xu', 'Yamamoto', 'Zimmer',
];
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'JP', 'BR', 'IN', 'NG', 'UA', 'PH', 'IR', 'MM', 'YE'];
const HIGH_RISK_PICKS = ['IR', 'MM', 'YE'];
const NORMAL_OCCUPATIONS = [
  'software_engineer', 'teacher', 'physician', 'accountant', 'retail_clerk', 'electrician',
  'graphic_designer', 'nurse', 'civil_servant', 'logistics_coordinator',
];
const CASH_OCCUPATIONS = [
  'restaurant_owner', 'car_dealer', 'construction_contractor', 'vending_machine_operator',
  'casino_operator', 'pawnbroker', 'jewelry_dealer',
];
const SOURCES_OF_FUNDS = [
  'salary', 'business_revenue', 'investments', 'inheritance', 'savings',
  'crypto', 'cash_intensive_business', 'unknown',
];
const ID_DOC_TYPES = ['passport', 'national_id', 'drivers_license'];

const ANALYSTS: Analyst[] = [
  { id: 'ana-001', name: 'Marta Ellison', role: 'senior_analyst' },
  { id: 'ana-002', name: 'Tommy Reyes', role: 'senior_analyst' },
  { id: 'ana-003', name: 'Grete Lindholm', role: 'analyst' },
  { id: 'ana-004', name: 'Kwame Osei', role: 'analyst' },
  { id: 'ana-005', name: 'Ines Morales', role: 'analyst' },
  { id: 'ana-006', name: 'Sofia Chen', role: 'compliance_manager' },
];

const APPROVE_NOTES = [
  'All documents verified; risk profile acceptable.',
  'EDD completed; source of funds corroborated by bank statements.',
  'Approved after senior review; monitoring threshold set.',
  'No adverse findings; standard monitoring applies.',
];
const REJECT_NOTES = [
  'Unable to verify source of funds after repeated requests.',
  'Sanctions match confirmed as true positive by compliance.',
  'Documentation appears falsified; application declined.',
  'Risk profile exceeds acceptable tolerance for onboarding.',
];
const ESCALATE_NOTES = [
  'PEP association requires senior analyst sign-off.',
  'Adverse media hits need legal review before decision.',
  'High-risk jurisdiction combined with opaque funds; escalating.',
  'Volume expectations inconsistent with stated occupation.',
];
const REVIEW_NOTES = [
  'Starting review; requesting additional documentation.',
  'Picked up from queue for initial screening.',
  'Review started; awaiting sanctions re-screen result.',
];

const db = openDb();

function resetSchema() {
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of ['policy_audit_events', 'review_policy', 'audit_events', 'risk_signals', 'cases', 'customers', 'analysts']) {
    db.exec(`DROP TABLE IF EXISTS ${t};`);
  }
  db.exec('DROP TRIGGER IF EXISTS audit_events_no_update;');
  db.exec('DROP TRIGGER IF EXISTS audit_events_no_delete;');
  db.exec(schemaSql());
  db.exec('PRAGMA foreign_keys = ON;');
}

const insertAnalyst = db.prepare('INSERT INTO analysts (id, name, role) VALUES (?, ?, ?)');
const insertCustomer = db.prepare(`INSERT INTO customers
  (id, full_name, date_of_birth, nationality, country_of_residence, occupation, email,
   account_opened_at, expected_monthly_volume_usd, source_of_funds, id_document_type,
   id_document_verified, address_verified, pep_flag, sanctions_hit, adverse_media_hits)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertCase = db.prepare(`INSERT INTO cases
  (id, reference, customer_id, status, risk_level, risk_score, assigned_to, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertSignal = db.prepare(`INSERT INTO risk_signals
  (id, case_id, code, title, description, severity, weight) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insertEvent = db.prepare(`INSERT INTO audit_events
  (id, case_id, sequence, actor_id, actor_name, action, from_status, to_status, note, created_at, prev_hash, hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

interface EventSpec {
  actor: Analyst;
  action: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus | null;
  note: string | null;
}

function seed() {
  resetSchema();
  const now = new Date();
  const analysts = ANALYSTS;
  const seniors = analysts.filter((a) => a.role === 'senior_analyst');
  const managers = analysts.filter((a) => a.role === 'compliance_manager');
  const juniors = analysts;

  const run = db.transaction(() => {
    for (const a of analysts) insertAnalyst.run(a.id, a.name, a.role);

    const numCustomers = 60;
    for (let i = 0; i < numCustomers; i++) {
      const highRisk = chance(0.22);
      const countryOfResidence = highRisk ? pick(HIGH_RISK_PICKS) : pick(COUNTRIES);
      const nationality = chance(0.75) ? countryOfResidence : pick(COUNTRIES);
      const fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const openedDaysAgo = chance(0.25) ? int(2, 29) : int(30, 900);
      const accountOpenedAt = new Date(
        now.getTime() - openedDaysAgo * 86400_000,
      ).toISOString();
      const birthYear = int(1955, 2002);
      const dateOfBirth = `${birthYear}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`;

      const customer: Customer = {
        id: `cus-${String(i + 1).padStart(3, '0')}`,
        fullName,
        dateOfBirth,
        nationality,
        countryOfResidence,
        occupation: chance(0.3) ? pick(CASH_OCCUPATIONS) : pick(NORMAL_OCCUPATIONS),
        email: `${fullName.toLowerCase().replace(/[^a-z ]/g, '').replace(/ +/g, '.')}@example-${pick(['mail', 'post', 'inbox'])}.com`,
        accountOpenedAt,
        expectedMonthlyVolumeUsd: chance(0.2) ? int(51_000, 400_000) : int(500, 49_000),
        sourceOfFunds: pick(SOURCES_OF_FUNDS),
        idDocumentType: pick(ID_DOC_TYPES),
        idDocumentVerified: chance(0.82),
        addressVerified: chance(0.8),
        pepFlag: chance(0.08),
        sanctionsHit: chance(0.05),
        adverseMediaHits: chance(0.25) ? int(1, 5) : 0,
      };

      insertCustomer.run(
        customer.id, customer.fullName, customer.dateOfBirth, customer.nationality,
        customer.countryOfResidence, customer.occupation, customer.email,
        customer.accountOpenedAt, customer.expectedMonthlyVolumeUsd, customer.sourceOfFunds,
        customer.idDocumentType, customer.idDocumentVerified ? 1 : 0,
        customer.addressVerified ? 1 : 0, customer.pepFlag ? 1 : 0,
        customer.sanctionsHit ? 1 : 0, customer.adverseMediaHits,
      );

      const { score, level, signals } = computeRisk(customer, now);
      const decisionMakers = level === 'high' ? managers : [...seniors, ...managers];
      const caseId = `case-${String(i + 1).padStart(3, '0')}`;
      const reference = `KYC-2026-${String(i + 1).padStart(4, '0')}`;
      const createdAt = new Date(now.getTime() - int(1, 45) * 86400_000).toISOString();

      // Status distribution: ~30% pending, ~20% in_review, ~25% approved, ~15% rejected, ~10% escalated
      const roll = rand();
      const status: CaseStatus =
        roll < 0.3 ? 'pending'
        : roll < 0.5 ? 'in_review'
        : roll < 0.75 ? 'approved'
        : roll < 0.9 ? 'rejected'
        : 'escalated';

      // Build the audit trail leading to the target status.
      const events: EventSpec[] = [
        {
          actor: pick(juniors),
          action: 'CASE_CREATED',
          fromStatus: null,
          toStatus: 'pending',
          note: 'Case created from onboarding pipeline.',
        },
      ];
      const actor = pick(juniors);
      let assignedTo: string | null = null;
      if (status !== 'pending') {
        events.push({
          actor, action: 'start_review', fromStatus: 'pending', toStatus: 'in_review',
          note: pick(REVIEW_NOTES),
        });
        assignedTo = actor.id;
      }
      if (status === 'approved') {
        const decisionMaker = pick(decisionMakers);
        events.push({
          actor: decisionMaker, action: 'approve', fromStatus: 'in_review', toStatus: 'approved',
          note: pick(APPROVE_NOTES),
        });
        assignedTo = decisionMaker.id;
      } else if (status === 'rejected') {
        const decisionMaker = pick(decisionMakers);
        events.push({
          actor: decisionMaker, action: 'reject', fromStatus: 'in_review', toStatus: 'rejected',
          note: pick(REJECT_NOTES),
        });
        assignedTo = decisionMaker.id;
      } else if (status === 'escalated') {
        events.push({
          actor, action: 'escalate', fromStatus: 'in_review', toStatus: 'escalated',
          note: pick(ESCALATE_NOTES),
        });
        // Some escalated cases have already been resolved.
        if (chance(0.5)) {
          const senior = pick(decisionMakers);
          const resolved = chance(0.5);
          events.push({
            actor: senior,
            action: resolved ? 'approve' : 'reject',
            fromStatus: 'escalated',
            toStatus: resolved ? 'approved' : 'rejected',
            note: pick(resolved ? APPROVE_NOTES : REJECT_NOTES),
          });
          assignedTo = senior.id;
        }
      }
      const finalStatus = (events[events.length - 1]?.toStatus ?? 'pending') as CaseStatus;
      const updatedAt = new Date(
        new Date(createdAt).getTime() + int(1, 20) * 86400_000,
      ).toISOString();

      insertCase.run(
        caseId, reference, customer.id, finalStatus, level, score, assignedTo,
        createdAt, updatedAt,
      );
      for (const s of signals) {
        insertSignal.run(randomUUID(), caseId, s.code, s.title, s.description, s.severity, s.weight);
      }

      let prevHash = GENESIS_HASH;
      events.forEach((e, idx) => {
        const sequence = idx + 1;
        const eventTime = new Date(
          new Date(createdAt).getTime() + (idx + 1) * 3600_000,
        ).toISOString();
        const fields = {
          caseId,
          sequence,
          actorId: e.actor.id,
          action: e.action,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          note: e.note,
          createdAt: eventTime,
        };
        const hash = computeEventHash(prevHash, fields);
        insertEvent.run(
          randomUUID(), caseId, sequence, e.actor.id, e.actor.name, e.action,
          e.fromStatus, e.toStatus, e.note, eventTime, prevHash, hash,
        );
        prevHash = hash;
      });
    }
  });
  run();

  const counts = db
    .prepare('SELECT status, COUNT(*) AS n FROM cases GROUP BY status ORDER BY status')
    .all() as Array<{ status: string; n: number }>;
  const risk = db
    .prepare('SELECT risk_level, COUNT(*) AS n FROM cases GROUP BY risk_level ORDER BY risk_level')
    .all() as Array<{ risk_level: string; n: number }>;
  console.log('Seeded KYC demo database.');
  console.log('  cases by status:', JSON.stringify(counts));
  console.log('  cases by risk_level:', JSON.stringify(risk));
}

seed();
