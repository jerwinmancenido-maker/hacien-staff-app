-- S-19: per-ATC 2307 lines. Additive; safe to re-run. No dropped columns.
-- Backfill: one line per existing Withholding2307 from its rate/atcCode/amount
-- when no lines exist yet. Parent columns stay readable.

CREATE TABLE IF NOT EXISTS `Withholding2307Line` (
    `id` VARCHAR(191) NOT NULL,
    `withholding2307Id` VARCHAR(191) NOT NULL,
    `rate` DECIMAL(5, 4) NOT NULL,
    `atcCode` VARCHAR(20) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Indexes (IF NOT EXISTS via information_schema guards for re-run safety)
SET @idx_wh := (
  SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Withholding2307Line' AND INDEX_NAME = 'Withholding2307Line_withholding2307Id_idx'
);
SET @sql_wh := IF(@idx_wh = 0,
  'CREATE INDEX `Withholding2307Line_withholding2307Id_idx` ON `Withholding2307Line`(`withholding2307Id`)',
  'SELECT 1');
PREPARE stmt_wh FROM @sql_wh; EXECUTE stmt_wh; DEALLOCATE PREPARE stmt_wh;

SET @idx_atc := (
  SELECT COUNT(1) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Withholding2307Line' AND INDEX_NAME = 'Withholding2307Line_atcCode_idx'
);
SET @sql_atc := IF(@idx_atc = 0,
  'CREATE INDEX `Withholding2307Line_atcCode_idx` ON `Withholding2307Line`(`atcCode`)',
  'SELECT 1');
PREPARE stmt_atc FROM @sql_atc; EXECUTE stmt_atc; DEALLOCATE PREPARE stmt_atc;

SET @fk := (
  SELECT COUNT(1) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Withholding2307Line'
    AND CONSTRAINT_NAME = 'Withholding2307Line_withholding2307Id_fkey' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_fk := IF(@fk = 0,
  'ALTER TABLE `Withholding2307Line` ADD CONSTRAINT `Withholding2307Line_withholding2307Id_fkey` FOREIGN KEY (`withholding2307Id`) REFERENCES `Withholding2307`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE stmt_fk FROM @sql_fk; EXECUTE stmt_fk; DEALLOCATE PREPARE stmt_fk;

-- Backfill: parents with amount > 0 and no child lines yet → one line from parent columns.
INSERT INTO `Withholding2307Line` (`id`, `withholding2307Id`, `rate`, `atcCode`, `amount`, `createdAt`, `updatedAt`)
SELECT
  REPLACE(UUID(), '-', ''),
  w.`id`,
  w.`rate`,
  w.`atcCode`,
  w.`amount`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `Withholding2307` w
WHERE w.`amount` > 0
  AND NOT EXISTS (
    SELECT 1 FROM `Withholding2307Line` l WHERE l.`withholding2307Id` = w.`id`
  );
