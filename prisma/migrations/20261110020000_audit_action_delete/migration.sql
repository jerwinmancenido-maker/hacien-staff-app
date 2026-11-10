-- Append 'delete' at the END of AuditAction. Existing audit rows are unchanged.
-- There is no data backfill: this only widens the enum so a hard delete of a
-- draft or void document can be recorded as what it is.
ALTER TABLE `AuditLog` MODIFY `action` ENUM('create', 'update', 'archive', 'restore', 'void', 'login', 'login_failed', 'login_2fa_pending', 'settings_change', 'email_draft', 'download', 'delete') NOT NULL;
