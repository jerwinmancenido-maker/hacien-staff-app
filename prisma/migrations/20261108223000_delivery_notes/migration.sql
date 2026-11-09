-- Delivery notes (2026-11-08): the delivery form had nowhere to record a
-- note (gate instructions, partial-delivery remarks). Additive and nullable;
-- existing deliveries keep null and behave exactly as before.
ALTER TABLE `Delivery` ADD COLUMN `notes` TEXT NULL;
