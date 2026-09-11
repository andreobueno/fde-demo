CREATE TABLE IF NOT EXISTS analysts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('analyst', 'senior_analyst', 'compliance_manager'))
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  nationality TEXT NOT NULL,
  country_of_residence TEXT NOT NULL,
  occupation TEXT NOT NULL,
  email TEXT NOT NULL,
  account_opened_at TEXT NOT NULL,
  expected_monthly_volume_usd REAL NOT NULL,
  source_of_funds TEXT NOT NULL,
  id_document_type TEXT NOT NULL,
  id_document_expires_at TEXT,
  id_document_verified INTEGER NOT NULL,
  address_verified INTEGER NOT NULL,
  pep_flag INTEGER NOT NULL,
  sanctions_hit INTEGER NOT NULL,
  adverse_media_hits INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'escalated')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  risk_score INTEGER NOT NULL,
  assigned_to TEXT REFERENCES analysts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_signals (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  weight INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  sequence INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (case_id, sequence)
);

CREATE TABLE IF NOT EXISTS risk_policy (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_policy_changes (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  changes TEXT NOT NULL,
  recomputed_cases INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS risk_policy_changes_no_update
BEFORE UPDATE ON risk_policy_changes
BEGIN
  SELECT RAISE(ABORT, 'risk_policy_changes is append-only');
END;

CREATE TRIGGER IF NOT EXISTS risk_policy_changes_no_delete
BEFORE DELETE ON risk_policy_changes
BEGIN
  SELECT RAISE(ABORT, 'risk_policy_changes is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;
