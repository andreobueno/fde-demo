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

CREATE TABLE IF NOT EXISTS case_risk_thresholds (
  case_id TEXT PRIMARY KEY REFERENCES cases(id),
  medium INTEGER NOT NULL CHECK (medium BETWEEN 1 AND 99),
  high INTEGER NOT NULL CHECK (high > medium AND high <= 100)
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

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  amount_cents INTEGER NOT NULL CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents > 0 AND amount_cents <= transaction_amount_cents
  ),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  transaction_reference TEXT NOT NULL,
  transaction_amount_cents INTEGER NOT NULL CHECK (
    typeof(transaction_amount_cents) = 'integer'
    AND transaction_amount_cents > 0 AND transaction_amount_cents <= 9007199254740991
  ),
  transaction_occurred_at TEXT NOT NULL,
  risk_indicators TEXT NOT NULL CHECK (json_valid(risk_indicators) AND json_type(risk_indicators) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS refunds_status_created_at ON refunds(status, created_at);
CREATE INDEX IF NOT EXISTS refunds_customer_id ON refunds(customer_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  refund_id TEXT REFERENCES refunds(id),
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
  CHECK ((case_id IS NOT NULL) + (refund_id IS NOT NULL) = 1),
  UNIQUE (case_id, sequence),
  UNIQUE (refund_id, sequence)
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

CREATE TRIGGER IF NOT EXISTS risk_policy_changes_no_replace
BEFORE INSERT ON risk_policy_changes
WHEN EXISTS (SELECT 1 FROM risk_policy_changes WHERE id = NEW.id OR version = NEW.version)
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

CREATE TABLE IF NOT EXISTS review_policy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  require_approval_note INTEGER NOT NULL CHECK (require_approval_note IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES analysts(id)
);

INSERT OR IGNORE INTO review_policy
  (id, version, require_approval_note, updated_at, updated_by)
VALUES (1, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL);

CREATE TABLE IF NOT EXISTS policy_audit_events (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action = 'policy_updated'),
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS policy_audit_events_no_update
BEFORE UPDATE ON policy_audit_events
BEGIN
  SELECT RAISE(ABORT, 'policy_audit_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS policy_audit_events_no_delete
BEFORE DELETE ON policy_audit_events
BEGIN
  SELECT RAISE(ABORT, 'policy_audit_events is append-only');
END;

CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  analyst_id TEXT NOT NULL REFERENCES analysts(id) ON DELETE CASCADE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS access_tokens_analyst_id ON access_tokens(analyst_id);

CREATE TABLE IF NOT EXISTS analyst_credentials (
  analyst_id TEXT PRIMARY KEY NOT NULL REFERENCES analysts(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '_%@_%._%'),
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  analyst_id TEXT NOT NULL REFERENCES analysts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_analyst_id ON sessions(analyst_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_last_used_at ON sessions(last_used_at);

CREATE TABLE IF NOT EXISTS auth_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event TEXT NOT NULL CHECK (
    event IN ('sign_in_succeeded', 'sign_in_failed', 'sign_in_throttled', 'sign_out')
  ),
  analyst_id TEXT REFERENCES analysts(id),
  email TEXT,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS auth_events_created_at ON auth_events(created_at);

CREATE TRIGGER IF NOT EXISTS auth_events_no_update
BEFORE UPDATE ON auth_events
BEGIN
  SELECT RAISE(ABORT, 'auth_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS auth_events_no_delete
BEFORE DELETE ON auth_events
BEGIN
  SELECT RAISE(ABORT, 'auth_events is append-only');
END;
