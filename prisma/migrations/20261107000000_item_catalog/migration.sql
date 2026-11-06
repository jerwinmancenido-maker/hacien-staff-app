-- Item catalog, Step 1 (Option A): master list of products staff quote.
-- Additive table only; quote/SO/PO lines and history are untouched.

CREATE TABLE `Item` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(120) NULL,
    `model` VARCHAR(120) NULL,
    `category` VARCHAR(120) NULL,
    `sku` VARCHAR(60) NULL,
    `unit` VARCHAR(30) NOT NULL,
    `kind` ENUM('GOODS', 'SERVICES') NOT NULL DEFAULT 'GOODS',
    `details` TEXT NULL,
    `defaultUnitPrice` DECIMAL(15, 2) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Item_active_idx`(`active`),
    INDEX `Item_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
