-- Additive: snapshot withholding rate + ATC on each quote/SO line, plus an
-- explicit staff-override flag. Existing rows stay NULL/false (never rewritten).
-- Also fill known ATC codes on the seeded rate rows when still blank.

ALTER TABLE `QuoteItem`
  ADD COLUMN `withholdingRate` DECIMAL(5, 4) NULL,
  ADD COLUMN `withholdingAtc` VARCHAR(20) NULL,
  ADD COLUMN `withholdingOverride` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `SalesOrderItem`
  ADD COLUMN `withholdingRate` DECIMAL(5, 4) NULL,
  ADD COLUMN `withholdingAtc` VARCHAR(20) NULL,
  ADD COLUMN `withholdingOverride` BOOLEAN NOT NULL DEFAULT false;

-- ATC labels live in src/lib/quotes/withholding-defaults.ts (ATC_LABELS).
-- Government codes (WG010, WV050) are UNVERIFIED — accountant review required.
UPDATE `WithholdingRate` SET `atcCode` = 'WI158' WHERE `code` = 'GOODS_1' AND (`atcCode` IS NULL OR `atcCode` = '');
UPDATE `WithholdingRate` SET `atcCode` = 'WI160' WHERE `code` = 'SERVICES_2' AND (`atcCode` IS NULL OR `atcCode` = '');
UPDATE `WithholdingRate` SET `atcCode` = 'WG010' WHERE `code` = 'GOV_PT_3' AND (`atcCode` IS NULL OR `atcCode` = '');
UPDATE `WithholdingRate` SET `atcCode` = 'WV050' WHERE `code` = 'GOV_VAT_5' AND (`atcCode` IS NULL OR `atcCode` = '');
