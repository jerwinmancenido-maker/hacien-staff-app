-- ERP adoption item 2 (hideable sidebar): the user's own sidebar show/hide
-- choice, stored on the user record so it is remembered across sign-ins and
-- devices (the ERP forgets it on reload). Additive only: defaults to false
-- (sidebar shown — exactly the pre-change behaviour for every existing user).

-- AlterTable
ALTER TABLE `User` ADD COLUMN `sidebarHidden` BOOLEAN NOT NULL DEFAULT false;
