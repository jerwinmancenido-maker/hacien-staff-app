-- Part 7c: manual tax-paid entries for quarterly income tax worksheets.
-- Additive only — no drops, renames, or data changes.

CREATE TABLE `TaxPaidQuarter` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `quarter` INTEGER NOT NULL,
    `amountPaid` DECIMAL(15, 2) NOT NULL,
    `notes` TEXT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TaxPaidQuarter_year_quarter_key`(`year`, `quarter`),
    INDEX `TaxPaidQuarter_year_idx`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TaxPaidQuarter` ADD CONSTRAINT `TaxPaidQuarter_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
