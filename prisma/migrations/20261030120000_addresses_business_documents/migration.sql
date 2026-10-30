-- AlterTable
ALTER TABLE `AuditLog` MODIFY `action` ENUM('create', 'update', 'archive', 'restore', 'void', 'login', 'login_failed', 'settings_change', 'email_draft', 'download') NOT NULL;

-- CreateTable
CREATE TABLE `Address` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `kind` ENUM('BILLING', 'DELIVERY', 'OFFICE', 'WAREHOUSE', 'OTHER') NOT NULL,
    `label` VARCHAR(100) NULL,
    `street` TEXT NOT NULL,
    `barangay` VARCHAR(120) NOT NULL DEFAULT '',
    `cityMunicipality` VARCHAR(120) NOT NULL DEFAULT '',
    `province` VARCHAR(120) NOT NULL DEFAULT '',
    `zip` VARCHAR(4) NOT NULL DEFAULT '',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `needsReview` BOOLEAN NOT NULL DEFAULT false,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Address_customerId_idx`(`customerId`),
    INDEX `Address_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BusinessDocument` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `type` ENUM('DTI', 'SEC', 'CDA', 'BIR_2303', 'MAYORS_PERMIT', 'PHILGEPS', 'BARANGAY_CLEARANCE', 'TAX_CLEARANCE', 'OTHER') NOT NULL,
    `otherLabel` VARCHAR(100) NULL,
    `docNumber` VARCHAR(100) NULL,
    `issueDate` DATE NULL,
    `expiryDate` DATE NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `storageKey` VARCHAR(64) NOT NULL,
    `sha256` VARCHAR(64) NOT NULL,
    `replacesId` VARCHAR(64) NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BusinessDocument_storageKey_key`(`storageKey`),
    INDEX `BusinessDocument_customerId_idx`(`customerId`),
    INDEX `BusinessDocument_supplierId_idx`(`supplierId`),
    INDEX `BusinessDocument_expiryDate_idx`(`expiryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Address` ADD CONSTRAINT `Address_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BusinessDocument` ADD CONSTRAINT `BusinessDocument_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BusinessDocument` ADD CONSTRAINT `BusinessDocument_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BusinessDocument` ADD CONSTRAINT `BusinessDocument_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- BEGIN legacy address backfill
-- Copy each old free-text address into the street of a default BILLING address,
-- flagged needsReview so someone splits it into barangay / city / province / ZIP.
-- Owners that already have an address are skipped, so running this twice is
-- harmless (tests/db/contacts03.db.test.ts runs it again). The old `address`
-- columns stay for one release and are dropped in a later migration.
INSERT INTO `Address` (`id`, `customerId`, `kind`, `street`, `isDefault`, `needsReview`, `createdAt`, `updatedAt`)
SELECT CONCAT('c', LOWER(REPLACE(UUID(), '-', ''))), c.`id`, 'BILLING', TRIM(c.`address`), true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Customer` c
WHERE c.`address` IS NOT NULL AND TRIM(c.`address`) <> ''
  AND NOT EXISTS (SELECT 1 FROM `Address` a WHERE a.`customerId` = c.`id`);

INSERT INTO `Address` (`id`, `supplierId`, `kind`, `street`, `isDefault`, `needsReview`, `createdAt`, `updatedAt`)
SELECT CONCAT('c', LOWER(REPLACE(UUID(), '-', ''))), s.`id`, 'BILLING', TRIM(s.`address`), true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `Supplier` s
WHERE s.`address` IS NOT NULL AND TRIM(s.`address`) <> ''
  AND NOT EXISTS (SELECT 1 FROM `Address` a WHERE a.`supplierId` = s.`id`);
-- END legacy address backfill
