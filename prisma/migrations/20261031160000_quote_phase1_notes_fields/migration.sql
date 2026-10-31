-- Quote Phase 1 (Brief 09): nullable fields only. Needs CTO review before any
-- live or staging apply. Do not run against production.
--
-- internalNotes: staff-only; NEVER prints; NEVER on customer-facing pages.
-- Existing Quote.notes stays as customer notes (prints as today).
-- subject / buyerPoNo: print on the quote when set (Phase 1 Quote details).

ALTER TABLE `Quote` ADD COLUMN `internalNotes` TEXT NULL;
ALTER TABLE `Quote` ADD COLUMN `subject` VARCHAR(500) NULL;
ALTER TABLE `Quote` ADD COLUMN `buyerPoNo` VARCHAR(64) NULL;
