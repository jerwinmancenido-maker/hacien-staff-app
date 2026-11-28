-- Collection fee capture (REQ-COLLECTION-FEES-001): an optional fee the
-- payment channel kept out of a collection (bank / GCash charge). The
-- billing still settles by the full amount received; the fee is expensed
-- separately against the same cash account so the account lands net.
-- Additive only: feeAmount defaults to 0 (no fee — exactly the pre-fee
-- behaviour for every existing row) and feeExpenseId links the fee
-- expense minted at collection time. No Billing change.

-- AlterTable
ALTER TABLE `Collection` ADD COLUMN `feeAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE `Collection` ADD COLUMN `feeExpenseId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Collection_feeExpenseId_key` ON `Collection`(`feeExpenseId`);

-- AddForeignKey
ALTER TABLE `Collection` ADD CONSTRAINT `Collection_feeExpenseId_fkey` FOREIGN KEY (`feeExpenseId`) REFERENCES `Expense`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
