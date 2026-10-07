-- Current data-encryption key version of each employee (KeyRotator, src/security/keys.ts). No row = version 1.
CREATE TABLE key_versions (
  employee_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_ms INTEGER NOT NULL
) STRICT;

-- The compliance key registration message (@badge/attest complianceKeyRegistrationMessage) carries no issue date:
-- the key is derived deterministically from the officer's Ledger, so freshness is replaced by "never roll back to a
-- key that was replaced" (see ComplianceService.registerKey). Keys are stored as lowercase hex without prefix.
ALTER TABLE compliance_keys DROP COLUMN issued_s;

-- Excerpt ids a cached brief was drafted from: a brief is redrafted when that set changes (e.g. after a revocation).
ALTER TABLE tasks ADD COLUMN brief_sources TEXT;
