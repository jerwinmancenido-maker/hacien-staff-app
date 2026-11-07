-- Modular quote terms (lawyer/CPA sign-off 2026-11-06). Additive only:
-- per-quote lead time in business days (null = no figure) and a customer
-- kind flag (false = business, the default for existing customers).
ALTER TABLE `Quote` ADD COLUMN `leadTimeDays` INTEGER NULL;
ALTER TABLE `Customer` ADD COLUMN `isIndividual` BOOLEAN NOT NULL DEFAULT false;
