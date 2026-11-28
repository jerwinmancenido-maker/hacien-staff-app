-- ERP adoption item 13 (assignment reminders that auto-close): record WHY a
-- reminder was auto-closed when its record reached its done state. Additive
-- only: a nullable column; every existing row keeps doneReason NULL, which
-- the app reads as "not auto-closed" (open, or closed by hand).

-- AlterTable
ALTER TABLE `Reminder` ADD COLUMN `doneReason` VARCHAR(200) NULL;
