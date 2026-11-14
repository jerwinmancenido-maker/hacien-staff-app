-- Phase 4 #10: period close. Additive only: one new table. No backfill —
-- the table starts empty (no month is closed until an Admin closes it)
-- and old code runs against the new schema unchanged (rollback =
-- redeploy old build; the extra table is inert).

CREATE TABLE `PeriodLock` (
    `id` VARCHAR(191) NOT NULL,
    `yearMonth` VARCHAR(7) NOT NULL,
    `closed` BOOLEAN NOT NULL DEFAULT false,
    `closedById` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `reopenedById` VARCHAR(191) NULL,
    `reopenedAt` DATETIME(3) NULL,
    `reopenReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PeriodLock_yearMonth_key`(`yearMonth`),
    INDEX `PeriodLock_closedById_idx`(`closedById`),
    INDEX `PeriodLock_reopenedById_idx`(`reopenedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PeriodLock` ADD CONSTRAINT `PeriodLock_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PeriodLock` ADD CONSTRAINT `PeriodLock_reopenedById_fkey` FOREIGN KEY (`reopenedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
