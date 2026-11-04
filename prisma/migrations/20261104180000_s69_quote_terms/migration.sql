-- S-69: per-quote delivery and warranty notes on the quote Terms tab.
-- Additive only: new nullable columns, existing quotes fall back to the
-- Settings print defaults on the print.
ALTER TABLE `Quote` ADD COLUMN `deliveryNotes` TEXT NULL;
ALTER TABLE `Quote` ADD COLUMN `warrantyNotes` TEXT NULL;
