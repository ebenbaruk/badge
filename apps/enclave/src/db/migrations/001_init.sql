-- Initial schema of the enclave state. Times are unix milliseconds (*_ms). Addresses are stored lower-case.
-- Excerpt text is stored only where the enclave must re-check a consent against it (task_excerpts, desk_offers):
-- the database lives on the CVM's encrypted disk, and the audit log never contains any excerpt text.

CREATE TABLE enrollments (
  employee_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  enrolled_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  session_key TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES enrollments (employee_id),
  agent_name TEXT NOT NULL,
  access TEXT NOT NULL,
  expires_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL,
  revoked_ms INTEGER
) STRICT;

-- One row per signed message ever accepted: the primary key makes nonce reuse impossible, even under concurrency.
CREATE TABLE used_nonces (
  signer TEXT NOT NULL,
  nonce TEXT NOT NULL,
  kind TEXT NOT NULL,
  used_ms INTEGER NOT NULL,
  PRIMARY KEY (signer, nonce)
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  task TEXT NOT NULL,
  task_label TEXT NOT NULL,
  full_context_of TEXT,
  created_ms INTEGER NOT NULL,
  brief TEXT,
  brief_ms INTEGER
) STRICT;

CREATE TABLE task_excerpts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks (id),
  owner_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'personal')),
  source_id TEXT NOT NULL,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  excerpt_hash TEXT NOT NULL,
  length INTEGER NOT NULL,
  tags TEXT NOT NULL,
  contains_personal_data INTEGER NOT NULL,
  relevance REAL NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'pending', 'blocked', 'rejected', 'expired')),
  basis TEXT CHECK (basis IN ('global', 'own', 'grant', 'policy', 'consent')),
  grant_id TEXT,
  policy_id TEXT,
  risk TEXT NOT NULL CHECK (risk IN ('ok', 'warn', 'block')),
  risk_reasons TEXT NOT NULL,
  created_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX task_excerpts_by_task ON task_excerpts (task_id);
CREATE INDEX task_excerpts_by_owner ON task_excerpts (owner_id, created_ms);

CREATE TABLE consent_requests (
  id TEXT PRIMARY KEY,
  task_excerpt_id INTEGER NOT NULL UNIQUE REFERENCES task_excerpts (id),
  task_id TEXT NOT NULL REFERENCES tasks (id),
  owner_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_ms INTEGER NOT NULL,
  decided_ms INTEGER,
  grant_id TEXT
) STRICT;

CREATE INDEX consent_requests_by_owner ON consent_requests (owner_id, status);

CREATE TABLE grants (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  excerpt_hash TEXT NOT NULL,
  expires_ms INTEGER NOT NULL,
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  consent_request_id TEXT NOT NULL REFERENCES consent_requests (id),
  created_ms INTEGER NOT NULL,
  revoked_ms INTEGER
) STRICT;

CREATE INDEX grants_lookup ON grants (owner_id, recipient_id, excerpt_hash);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  grantee_team TEXT NOT NULL,
  context_tag TEXT NOT NULL,
  purpose TEXT NOT NULL,
  max_excerpt_length INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  revoked_ms INTEGER
) STRICT;

CREATE INDEX policies_by_owner ON policies (owner_id);

CREATE TABLE policy_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL REFERENCES policies (id),
  task_id TEXT NOT NULL REFERENCES tasks (id),
  recipient_id TEXT NOT NULL,
  excerpt_hash TEXT NOT NULL,
  used_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE revocations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  target_label TEXT NOT NULL,
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  grants_revoked INTEGER NOT NULL,
  policies_revoked INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
) STRICT;

-- Registration order fixes the Semaphore group root: members are always read back ordered by seq.
CREATE TABLE desk_members (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  desk_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  commitment TEXT NOT NULL,
  fixture INTEGER NOT NULL,
  joined_ms INTEGER NOT NULL,
  UNIQUE (desk_id, commitment),
  UNIQUE (desk_id, employee_id)
) STRICT;

CREATE TABLE desk_requests (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  from_desk TEXT NOT NULL,
  source_desk TEXT NOT NULL,
  task TEXT NOT NULL,
  created_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE desk_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES desk_requests (id),
  owner_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  excerpt_hash TEXT NOT NULL,
  length INTEGER NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'rejected')),
  proof TEXT,
  nullifier TEXT,
  created_ms INTEGER NOT NULL,
  decided_ms INTEGER,
  UNIQUE (request_id, owner_id)
) STRICT;

CREATE TABLE nullifiers (
  scope TEXT NOT NULL,
  nullifier TEXT NOT NULL,
  used_ms INTEGER NOT NULL,
  PRIMARY KEY (scope, nullifier)
) STRICT;

CREATE TABLE audit_log (
  seq INTEGER PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  subject TEXT NOT NULL,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
) STRICT;

-- Append-only at the storage level too: a bug (or an injected statement) cannot rewrite history in place.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TABLE compliance_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  issued_s INTEGER NOT NULL,
  signature TEXT NOT NULL,
  registered_ms INTEGER NOT NULL
) STRICT;
