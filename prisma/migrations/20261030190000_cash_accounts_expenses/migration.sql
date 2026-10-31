-- Part 7a: cash/bank accounts, expenses, transfers. Additive only.
-- Hand-recorded; the app never connects to a bank.

-- AlterTable: DocType gains EXPENSE, CASH_TRANSFER
ALTER TABLE `DocumentSeries` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_TRANSFER') NOT NULL;
ALTER TABLE `DocumentVoid` MODIFY `docType` ENUM('QUOTE', 'SALES_ORDER', 'PURCHASE_ORDER', 'RECEIVING_REPORT', 'SUPPLIER_BILL', 'BILLING', 'COLLECTION', 'SUPPLIER_PAYMENT', 'EXPENSE', 'CASH_TRANSFER') NOT NULL;

-- CreateTable
CREATE TABLE `CashAccount` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` ENUM('CASH_ON_HAND', 'BANK', 'E_WALLET') NOT NULL,
    `bankName` VARCHAR(120) NULL,
    `accountHintLast4` VARCHAR(4) NULL,
    `openingBalance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `openingDate` DATE NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `archivedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CashAccount_active_idx`(`active`),
    INDEX `CashAccount_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseCategory` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExpenseCategory_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `date` DATE NOT NULL,
    `supplierId` VARCHAR(191) NULL,
    `payeeText` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `withholdingApplied` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `cashAccountId` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(64) NULL,
    `notes` TEXT NULL,
    `status` ENUM('POSTED', 'VOID') NOT NULL DEFAULT 'POSTED',
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Expense_number_key`(`number`),
    INDEX `Expense_date_idx`(`date`),
    INDEX `Expense_status_idx`(`status`),
    INDEX `Expense_cashAccountId_idx`(`cashAccountId`),
    INDEX `Expense_categoryId_idx`(`categoryId`),
    INDEX `Expense_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashTransfer` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `date` DATE NOT NULL,
    `fromAccountId` VARCHAR(191) NOT NULL,
    `toAccountId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('POSTED', 'VOID') NOT NULL DEFAULT 'POSTED',
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CashTransfer_number_key`(`number`),
    INDEX `CashTransfer_date_idx`(`date`),
    INDEX `CashTransfer_status_idx`(`status`),
    INDEX `CashTransfer_fromAccountId_idx`(`fromAccountId`),
    INDEX `CashTransfer_toAccountId_idx`(`toAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: Collection / SupplierPayment gain optional cashAccountId
ALTER TABLE `Collection` ADD COLUMN `cashAccountId` VARCHAR(191) NULL;
CREATE INDEX `Collection_cashAccountId_idx` ON `Collection`(`cashAccountId`);

ALTER TABLE `SupplierPayment` ADD COLUMN `cashAccountId` VARCHAR(191) NULL;
CREATE INDEX `SupplierPayment_cashAccountId_idx` ON `SupplierPayment`(`cashAccountId`);

-- AlterTable: DocumentAttachment gains expense owner
ALTER TABLE `DocumentAttachment` ADD COLUMN `expenseId` VARCHAR(191) NULL;
CREATE INDEX `DocumentAttachment_expenseId_idx` ON `DocumentAttachment`(`expenseId`);

-- Seed expense categories (editable; never deleted — set active=false instead)
INSERT INTO `ExpenseCategory` (`id`, `code`, `label`, `active`, `sortOrder`, `createdAt`, `updatedAt`) VALUES
  ('expcat_rent', 'RENT', 'Rent', true, 10, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_utilities', 'UTILITIES', 'Utilities', true, 20, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_internet', 'INTERNET', 'Internet', true, 30, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_transport', 'TRANSPORT', 'Transport', true, 40, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_office', 'OFFICE_SUPPLIES', 'Office supplies', true, 50, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_fees', 'PROFESSIONAL_FEES', 'Professional fees', true, 60, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_bank', 'BANK_CHARGES', 'Bank charges', true, 70, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_tax', 'TAXES_LICENSES', 'Taxes and licenses', true, 80, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('expcat_other', 'OTHER', 'Other', true, 90, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- AddForeignKey
ALTER TABLE `CashAccount` ADD CONSTRAINT `CashAccount_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CashAccount` ADD CONSTRAINT `CashAccount_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Expense` ADD CONSTRAINT `Expense_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ExpenseCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_cashAccountId_fkey` FOREIGN KEY (`cashAccountId`) REFERENCES `CashAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CashTransfer` ADD CONSTRAINT `CashTransfer_fromAccountId_fkey` FOREIGN KEY (`fromAccountId`) REFERENCES `CashAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CashTransfer` ADD CONSTRAINT `CashTransfer_toAccountId_fkey` FOREIGN KEY (`toAccountId`) REFERENCES `CashAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CashTransfer` ADD CONSTRAINT `CashTransfer_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Collection` ADD CONSTRAINT `Collection_cashAccountId_fkey` FOREIGN KEY (`cashAccountId`) REFERENCES `CashAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `SupplierPayment` ADD CONSTRAINT `SupplierPayment_cashAccountId_fkey` FOREIGN KEY (`cashAccountId`) REFERENCES `CashAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
