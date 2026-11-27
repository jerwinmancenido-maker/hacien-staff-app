-- Collection deductions (ERP payment-entry model, 2026-11-28; storage
-- shape per Review Board run 100, finding 1397): the collection form's
-- single fee field becomes a deductions list, one row per deduction.
-- FEE = the channel's charge (generalises the PR #354 collection fee);
-- OTHER = any other amount the payer kept, with a staff-typed label;
-- WITHHOLDING = the settlement mirror of a billing's 2307 amount (the
-- allocations + Withholding2307 records stay the source of truth).
-- cashAffecting splits the cash effect (finding 1398): cash-affecting
-- rows post one linked expense against the collection's cash account;
-- settlement-only rows settle the billing with no account movement and
-- no expense (expenseId stays NULL). Additive only: one new table, no
-- existing column or row changes. Legacy fee-only collections keep
-- using Collection.feeAmount / feeExpenseId; new collections write
-- rows here and keep those two fields synced to the FEE row.

-- CreateTable
CREATE TABLE `CollectionDeduction` (
    `id` VARCHAR(191) NOT NULL,
    `collectionId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `cashAffecting` BOOLEAN NOT NULL DEFAULT true,
    `expenseId` VARCHAR(191) NULL,
    `billingId` VARCHAR(191) NULL,
    `withholding2307Id` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CollectionDeduction_expenseId_key`(`expenseId`),
    UNIQUE INDEX `CollectionDeduction_withholding2307Id_key`(`withholding2307Id`),
    INDEX `CollectionDeduction_collectionId_idx`(`collectionId`),
    INDEX `CollectionDeduction_billingId_idx`(`billingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CollectionDeduction` ADD CONSTRAINT `CollectionDeduction_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `Collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CollectionDeduction` ADD CONSTRAINT `CollectionDeduction_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CollectionDeduction` ADD CONSTRAINT `CollectionDeduction_billingId_fkey` FOREIGN KEY (`billingId`) REFERENCES `Billing`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CollectionDeduction` ADD CONSTRAINT `CollectionDeduction_withholding2307Id_fkey` FOREIGN KEY (`withholding2307Id`) REFERENCES `Withholding2307`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
