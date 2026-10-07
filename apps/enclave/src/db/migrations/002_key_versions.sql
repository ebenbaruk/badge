-- Current version of each employee's data-encryption key (src/security/keys.ts). Persisted so that a key rotated
-- after a revocation stays rotated across restarts: the previous key must never come back.
CREATE TABLE key_versions (
  employee_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1)
) STRICT;
