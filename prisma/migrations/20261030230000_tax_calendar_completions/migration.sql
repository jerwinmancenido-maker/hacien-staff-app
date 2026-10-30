-- Part 7d: tax calendar mark-as-done notes (not a filing).
-- Additive only — no drops, renames, or data changes.

CREATE TABLE `TaxCalendarCompletion` (
    `id` VARCHAR(191) NOT NULL,
    `obligationKey` VARCHAR(40) NOT NULL,
    `periodKey` VARCHAR(32) NOT NULL,
    `occurrenceKey` VARCHAR(80) NOT NULL,
    `dueDate` DATE NULL,
    `doneDate` DATE NOT NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `undoneAt` DATETIME(3) NULL,
    `undoneById` VARCHAR(191) NULL,

    INDEX `TaxCalendarCompletion_occurrenceKey_undoneAt_idx`(`occurrenceKey`, `undoneAt`),
    INDEX `TaxCalendarCompletion_obligationKey_idx`(`obligationKey`),
    INDEX `TaxCalendarCompletion_doneDate_idx`(`doneDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TaxCalendarCompletion` ADD CONSTRAINT `TaxCalendarCompletion_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TaxCalendarCompletion` ADD CONSTRAINT `TaxCalendarCompletion_undoneById_fkey` FOREIGN KEY (`undoneById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
