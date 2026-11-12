-- REQ-ATTACH-001 (finish-all Phase 1): attachments on sales orders and
-- purchase orders, plus a per-file kind label. Additive only — three new
-- nullable columns, two indexes, two foreign keys. No backfill: existing
-- rows keep NULL owners and NULL kind, which reads as "not an SO/PO file".
--
-- Note: `DocumentAttachment_quoteId_idx` is NOT created here. The index
-- already exists — 20261104190000_s70_quote_signoff created it in SQL —
-- but schema.prisma never declared @@index([quoteId]). This change adds
-- the missing declaration to the schema only; re-creating the index here
-- would fail on every database that already ran the S-70 migration.
ALTER TABLE `DocumentAttachment` ADD COLUMN `salesOrderId` VARCHAR(191) NULL;
ALTER TABLE `DocumentAttachment` ADD COLUMN `purchaseOrderId` VARCHAR(191) NULL;
ALTER TABLE `DocumentAttachment` ADD COLUMN `kind` VARCHAR(40) NULL;
ALTER TABLE `DocumentAttachment` ADD INDEX `DocumentAttachment_salesOrderId_idx` (`salesOrderId`);
ALTER TABLE `DocumentAttachment` ADD INDEX `DocumentAttachment_purchaseOrderId_idx` (`purchaseOrderId`);
-- The salesOrderId FK is ON DELETE SET NULL, deliberately NOT the RESTRICT
-- the other owner FKs use: plan amendment (a) lets a void sales order be
-- deleted once its files are archived, and the archived attachment rows
-- (and their files) must survive that delete for the record — so the link
-- nulls instead of blocking the delete. Purchase orders are never
-- hard-deleted, so purchaseOrderId keeps the usual RESTRICT.
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DocumentAttachment` ADD CONSTRAINT `DocumentAttachment_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
