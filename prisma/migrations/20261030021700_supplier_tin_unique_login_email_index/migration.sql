-- DropIndex
DROP INDEX `Supplier_tin_idx` ON `Supplier`;

-- CreateIndex
CREATE INDEX `LoginAttempt_email_createdAt_idx` ON `LoginAttempt`(`email`, `createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `Supplier_tin_key` ON `Supplier`(`tin`);

