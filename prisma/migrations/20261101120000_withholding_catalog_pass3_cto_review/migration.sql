-- CTO REVIEW REQUIRED before applying to staging/live.
--
-- Pass 3 Settings → Withholding catalog (labels + ATCs from BIR Form 2307 appendix).
-- Touches WithholdingRate rows ONLY:
--   - upserts the six default rates (order, labels, ATCs, active flags)
--   - does NOT rewrite Customer.defaultWithholding, Quote.withholdingPick,
--     line withholdingRate/Atc snapshots, sales orders, or billings
--
-- ATC codes Confirmed from:
--   https://bangsamoro.gov.ph/wp-content/uploads/2024/12/Appendix-26-BIR-Form-2307.pdf
-- Rate percentages remain Unverified until accountant review.
-- WI* codes assume an individual / sole-proprietor payee.

-- New government goods / services rows (skip if already present).
INSERT IGNORE INTO `WithholdingRate` (`id`, `code`, `label`, `lineKind`, `atcCode`, `rate`, `active`, `note`, `sortOrder`, `updatedAt`) VALUES
  ('whr_gov_goods_1', 'GOV_GOODS_1', 'Government goods 1% (WI640)', 'GOODS', 'WI640', 0.0100, true, 'verify with BIR', 1, CURRENT_TIMESTAMP(3)),
  ('whr_gov_services_2', 'GOV_SERVICES_2', 'Government services 2% (WI157)', 'SERVICES', 'WI157', 0.0200, true, 'verify with BIR', 2, CURRENT_TIMESTAMP(3));

-- Refresh known catalog rows (label / ATC / sort / active). Never deletes.
UPDATE `WithholdingRate` SET
  `label` = 'Government goods 1% (WI640)',
  `lineKind` = 'GOODS',
  `atcCode` = 'WI640',
  `rate` = 0.0100,
  `active` = true,
  `sortOrder` = 1,
  `note` = 'verify with BIR',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'GOV_GOODS_1';

UPDATE `WithholdingRate` SET
  `label` = 'Government services 2% (WI157)',
  `lineKind` = 'SERVICES',
  `atcCode` = 'WI157',
  `rate` = 0.0200,
  `active` = true,
  `sortOrder` = 2,
  `note` = 'verify with BIR',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'GOV_SERVICES_2';

UPDATE `WithholdingRate` SET
  `label` = 'Government percentage tax 3% (WB080)',
  `lineKind` = 'GOV_PT',
  `atcCode` = 'WB080',
  `rate` = 0.0300,
  `active` = true,
  `sortOrder` = 3,
  `note` = 'verify with BIR',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'GOV_PT_3';

UPDATE `WithholdingRate` SET
  `label` = 'Private top agent goods 1% (WI158)',
  `lineKind` = 'GOODS',
  `atcCode` = 'WI158',
  `rate` = 0.0100,
  `active` = true,
  `sortOrder` = 4,
  `note` = 'verify with BIR',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'GOODS_1';

UPDATE `WithholdingRate` SET
  `label` = 'Private top agent services 2% (WI160)',
  `lineKind` = 'SERVICES',
  `atcCode` = 'WI160',
  `rate` = 0.0200,
  `active` = true,
  `sortOrder` = 5,
  `note` = 'verify with BIR',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'SERVICES_2';

UPDATE `WithholdingRate` SET
  `label` = 'VAT withheld 5% (WV010/WV020)',
  `lineKind` = 'GOV_VAT',
  `atcCode` = 'WV010/WV020',
  `rate` = 0.0500,
  `active` = false,
  `sortOrder` = 6,
  `note` = 'verify with BIR',
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'GOV_VAT_5';

-- Never offer a combined "Goods 4%" Settings row (staff combine 1% + 3%).
UPDATE `WithholdingRate` SET `active` = false, `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` LIKE 'LINE_%' OR `label` = 'Goods 4%';
