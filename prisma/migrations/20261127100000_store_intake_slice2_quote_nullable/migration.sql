-- Online store intake, Slice 2 (Gap 1): a store-converted Sales Order has
-- no source quote, so SalesOrder.quoteId widens to nullable. Widening only:
-- every existing row keeps its quote; the FK and index are untouched.

-- AlterTable
ALTER TABLE `SalesOrder` MODIFY `quoteId` VARCHAR(191) NULL;
