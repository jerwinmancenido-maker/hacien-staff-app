-- Audit: record customer acceptance on a quote (date, name, how) so
-- quote -> SO conversion can require acceptance evidence. Additive only;
-- null on old quotes, which stay convertible via a conforme file or a
-- buyer PO number.
ALTER TABLE `Quote` ADD COLUMN `acceptedAt` DATETIME(3) NULL;
ALTER TABLE `Quote` ADD COLUMN `acceptedBy` VARCHAR(128) NULL;
ALTER TABLE `Quote` ADD COLUMN `acceptedVia` VARCHAR(32) NULL;
