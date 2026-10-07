-- Desk identities derived from a public seed (the former demo fixtures) let anyone prove membership: they are
-- removed, and every member now joins with their own Ledger (DeskJoin).
DELETE FROM desk_members WHERE fixture = 1;
ALTER TABLE desk_members DROP COLUMN fixture;

-- Root of the source desk's group when the request was created (decimal): every share of the request must prove
-- membership against it, and the requester verifies the proofs against it. NULL only for requests made before
-- this migration, which can no longer be answered.
ALTER TABLE desk_requests ADD COLUMN source_root TEXT;
