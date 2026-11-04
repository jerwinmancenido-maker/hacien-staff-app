-- Q16 S-95: per-customer order text switch (ON by default for new and
-- existing customers via the column default) + duplicate-prevention table.
-- Additive only: no column deleted or renamed.
ALTER TABLE `Customer` ADD COLUMN `orderTextUpdates` BOOLEAN NOT NULL DEFAULT TRUE;

-- CreateTable
CREATE TABLE `OrderTextSent` (
    `id` VARCHAR(191) NOT NULL,
    `eventKey` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `salesOrderId` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrderTextSent_salesOrderId_idx`(`salesOrderId`),
    UNIQUE INDEX `OrderTextSent_eventKey_key`(`eventKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
