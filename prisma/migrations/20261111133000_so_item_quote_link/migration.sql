-- Part A markers: link each sales-order line to the quote line it was copied
-- from at conversion. Additive only; existing rows stay NULL (no backfill is
-- possible — the copy did not record the link) and simply show no marker.
ALTER TABLE `SalesOrderItem` ADD COLUMN `quoteItemId` VARCHAR(191) NULL;
