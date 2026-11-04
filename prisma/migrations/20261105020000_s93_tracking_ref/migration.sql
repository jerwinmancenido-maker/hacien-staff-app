-- S-93: random tracking reference on sales orders. Additive only; null on old orders.
ALTER TABLE `SalesOrder` ADD COLUMN `trackingRef` VARCHAR(24) NULL;
CREATE UNIQUE INDEX `SalesOrder_trackingRef_key` ON `SalesOrder` (`trackingRef`);
