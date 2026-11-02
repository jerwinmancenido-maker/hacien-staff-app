-- Additive: cross-table unique claim for SI/DR/CR booklet serials.
CREATE TABLE `BookletSerialClaim` (
    `type` ENUM('SI', 'DR', 'CR') NOT NULL,
    `number` INTEGER NOT NULL,

    PRIMARY KEY (`type`, `number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill SI from existing billings and spoiled rows.
INSERT IGNORE INTO `BookletSerialClaim` (`type`, `number`)
SELECT 'SI', `invoiceNo` FROM `Billing`;

INSERT IGNORE INTO `BookletSerialClaim` (`type`, `number`)
SELECT `type`, `number` FROM `SpoiledBookletNumber`;

-- Backfill digit-only DR / CR strings (prefixed forms are claimed on next write via app parse).
INSERT IGNORE INTO `BookletSerialClaim` (`type`, `number`)
SELECT 'DR', CAST(`drNumber` AS UNSIGNED) FROM `Delivery`
WHERE `drNumber` REGEXP '^[0-9]+$' AND CAST(`drNumber` AS UNSIGNED) >= 1;

INSERT IGNORE INTO `BookletSerialClaim` (`type`, `number`)
SELECT 'CR', CAST(`receiptNo` AS UNSIGNED) FROM `Collection`
WHERE `receiptNo` IS NOT NULL AND `receiptNo` REGEXP '^[0-9]+$' AND CAST(`receiptNo` AS UNSIGNED) >= 1;
