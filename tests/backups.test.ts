import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_FACTS,
  BACKUP_FACTS_AS_OF,
  BACKUP_NOT_IN_PLACE,
} from "@/lib/backups/facts";

describe("backups facts (Q14, S-47)", () => {
  it("lists only the verified facts, as of the tracker date", () => {
    expect(BACKUP_FACTS_AS_OF).toBe("Nov 3, 2026");
    expect(BACKUP_FACTS.map((f) => f.title)).toEqual([
      "Manual staging database export before every deploy with a migration",
      "Hostinger automatic backup is ON",
    ]);
    const manual = BACKUP_FACTS[0]!.detail;
    expect(manual).toContain("6 such exports");
    expect(manual).toContain("Oct 31 to Nov 1, 11:56 PM PHT");
    expect(manual).toContain("CTO's box");
    expect(manual).toContain("owner-only");
    expect(manual).toContain("not off-site");
    const hostinger = BACKUP_FACTS[1]!.detail;
    expect(hostinger).toContain("Frequency, retention, and the latest backup date have not been checked");
  });

  it("explicitly lists what is not in place, never claiming it", () => {
    expect(BACKUP_NOT_IN_PLACE.map((f) => f.title)).toEqual([
      "No scheduled app backup",
      "No off-site copy",
      "No restore test",
    ]);
    // In-place facts must not, on their own, claim a daily or scheduled backup.
    const inPlace = BACKUP_FACTS.map((f) => `${f.title} ${f.detail}`).join(" ");
    expect(inPlace).not.toMatch(/daily/i);
    expect(inPlace).not.toMatch(/scheduled app backup/i);
    expect(inPlace).not.toMatch(/restore tested/i);
  });

  it("has an Admin-only backups page that states it is facts only", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(app)/backups/page.tsx"), "utf8");
    expect(page).toContain('requirePagePermission("manage_settings")');
    expect(page).toContain("Facts only");
    expect(page).toContain("does not claim daily backups");
    expect(page).toContain("off-site copy");
    expect(page).toContain("tested restore");
  });

  it("is linked from the Admin sidebar, not the main nav", () => {
    const sidebar = readFileSync(path.join(process.cwd(), "src/components/Sidebar.tsx"), "utf8");
    expect(sidebar).toContain('{ href: "/backups", label: "Backups"');
    expect(sidebar).toContain("backups: \"Backups\"");
  });
});
