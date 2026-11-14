-- Phase 4 #4: CSV import writes ONE audit row per import with action
-- 'import'. Append 'import' at the END of AuditAction (existing rows keep
-- their values). No backfill — this only widens the enum, and old code
-- runs against the new schema unchanged (rollback = redeploy old build;
-- the extra enum value is inert for it).
ALTER TABLE `AuditLog` MODIFY `action` ENUM('create', 'update', 'archive', 'restore', 'void', 'login', 'login_failed', 'login_2fa_pending', 'settings_change', 'email_draft', 'download', 'delete', 'send_email', 'import') NOT NULL;
