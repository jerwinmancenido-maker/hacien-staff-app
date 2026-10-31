-- Backfill NULL quote/SO line withholding rates from the document-level
-- withholding JSON (legacy rows left NULL by 20261031120000). Without this,
-- the first save after migrate recomputes WH as ₱0 and overwrites stored money.
--
-- Rollback / down SQL is in the commented blocks at the bottom (not executed by
-- `prisma migrate deploy`). Tests extract those blocks for a round-trip.

-- BEGIN line withholding backfill
-- Pass 1: match document snapshot rows whose lineKind equals the item kind
-- (TWA goods 1% / services 2%).
UPDATE `QuoteItem` qi
INNER JOIN `Quote` q ON q.`id` = qi.`quoteId`
INNER JOIN JSON_TABLE(
  q.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate',
    `atcCode` VARCHAR(20) PATH '$.atcCode'
  )
) jt ON jt.`lineKind` COLLATE utf8mb4_unicode_ci = qi.`kind`
SET
  qi.`withholdingRate` = jt.`rate`,
  qi.`withholdingAtc` = NULLIF(jt.`atcCode`, '')
WHERE qi.`withholdingRate` IS NULL
  AND qi.`removedAt` IS NULL
  AND q.`withholdingTotal` <> 0;

UPDATE `SalesOrderItem` si
INNER JOIN `SalesOrder` so ON so.`id` = si.`salesOrderId`
INNER JOIN JSON_TABLE(
  so.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate',
    `atcCode` VARCHAR(20) PATH '$.atcCode'
  )
) jt ON jt.`lineKind` COLLATE utf8mb4_unicode_ci = si.`kind`
SET
  si.`withholdingRate` = jt.`rate`,
  si.`withholdingAtc` = NULLIF(jt.`atcCode`, '')
WHERE si.`withholdingRate` IS NULL
  AND si.`removedAt` IS NULL
  AND so.`withholdingTotal` <> 0;

-- Pass 2: government docs (GOV_PT / GOV_VAT) — apply the gov rate to every
-- remaining null line on docs that still have WH.
UPDATE `QuoteItem` qi
INNER JOIN `Quote` q ON q.`id` = qi.`quoteId`
INNER JOIN JSON_TABLE(
  q.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate',
    `atcCode` VARCHAR(20) PATH '$.atcCode'
  )
) jt ON jt.`lineKind` COLLATE utf8mb4_unicode_ci IN ('GOV_PT', 'GOV_VAT')
SET
  qi.`withholdingRate` = jt.`rate`,
  qi.`withholdingAtc` = NULLIF(jt.`atcCode`, '')
WHERE qi.`withholdingRate` IS NULL
  AND qi.`removedAt` IS NULL
  AND q.`withholdingTotal` <> 0;

UPDATE `SalesOrderItem` si
INNER JOIN `SalesOrder` so ON so.`id` = si.`salesOrderId`
INNER JOIN JSON_TABLE(
  so.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate',
    `atcCode` VARCHAR(20) PATH '$.atcCode'
  )
) jt ON jt.`lineKind` COLLATE utf8mb4_unicode_ci IN ('GOV_PT', 'GOV_VAT')
SET
  si.`withholdingRate` = jt.`rate`,
  si.`withholdingAtc` = NULLIF(jt.`atcCode`, '')
WHERE si.`withholdingRate` IS NULL
  AND si.`removedAt` IS NULL
  AND so.`withholdingTotal` <> 0;
-- END line withholding backfill

/*
-- BEGIN rollback line withholding backfill
-- Reverse of the backfill only (keeps the columns). Clears non-override rates
-- that still match the document snapshot so a re-run of the backfill can
-- restore them. Not executed by migrate deploy.
UPDATE `QuoteItem` qi
INNER JOIN `Quote` q ON q.`id` = qi.`quoteId`
LEFT JOIN JSON_TABLE(
  q.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate'
  )
) jt_kind ON jt_kind.`lineKind` COLLATE utf8mb4_unicode_ci = qi.`kind`
LEFT JOIN JSON_TABLE(
  q.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate'
  )
) jt_gov ON jt_gov.`lineKind` COLLATE utf8mb4_unicode_ci IN ('GOV_PT', 'GOV_VAT')
SET
  qi.`withholdingRate` = NULL,
  qi.`withholdingAtc` = NULL
WHERE qi.`withholdingOverride` = false
  AND qi.`withholdingRate` IS NOT NULL
  AND (
    (jt_kind.`rate` IS NOT NULL AND qi.`withholdingRate` = jt_kind.`rate`)
    OR (jt_kind.`rate` IS NULL AND jt_gov.`rate` IS NOT NULL AND qi.`withholdingRate` = jt_gov.`rate`)
  );

UPDATE `SalesOrderItem` si
INNER JOIN `SalesOrder` so ON so.`id` = si.`salesOrderId`
LEFT JOIN JSON_TABLE(
  so.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate'
  )
) jt_kind ON jt_kind.`lineKind` COLLATE utf8mb4_unicode_ci = si.`kind`
LEFT JOIN JSON_TABLE(
  so.`withholding`,
  '$[*]' COLUMNS (
    `lineKind` VARCHAR(20) PATH '$.lineKind',
    `rate` DECIMAL(5, 4) PATH '$.rate'
  )
) jt_gov ON jt_gov.`lineKind` COLLATE utf8mb4_unicode_ci IN ('GOV_PT', 'GOV_VAT')
SET
  si.`withholdingRate` = NULL,
  si.`withholdingAtc` = NULL
WHERE si.`withholdingOverride` = false
  AND si.`withholdingRate` IS NOT NULL
  AND (
    (jt_kind.`rate` IS NOT NULL AND si.`withholdingRate` = jt_kind.`rate`)
    OR (jt_kind.`rate` IS NULL AND jt_gov.`rate` IS NOT NULL AND si.`withholdingRate` = jt_gov.`rate`)
  );
-- END rollback line withholding backfill
*/
