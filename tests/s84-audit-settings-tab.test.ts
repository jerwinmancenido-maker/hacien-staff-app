import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-84: audit log moves into Settings as its own tab (Admin only), off
// the main sidebar. Rows read as plain sentences with record numbers and
// names instead of raw ids, plus a record link, and filters by date,
// person and record type. Records are never deleted.

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("S-84 audit log in Settings", () => {
  it("Settings has an Audit log tab and the sidebar no longer lists it", () => {
    const settings = read("src/app/(app)/settings/page.tsx");
    expect(settings).toContain('key: "audit", label: "Audit log"');
    expect(settings).toContain("AuditLogTab");
    const sidebar = read("src/components/Sidebar.tsx");
    expect(sidebar).not.toContain('href: "/audit"');
  });

  it("the old /audit route redirects to the Settings tab", () => {
    const page = read("src/app/(app)/audit/page.tsx");
    expect(page).toContain('redirect("/settings?tab=audit")');
    expect(read("src/lib/home/hrefs.ts")).toContain('"/settings?tab=audit"');
  });

  it("audit rows resolve to numbers/names and plain sentences", () => {
    const lib = read("src/lib/audit-log.ts");
    expect(lib).toContain("resolveAuditLabels");
    expect(lib).toContain("auditSentence");
    expect(lib).toContain("Voided");
    expect(lib).toContain("voidReason");
    const tab = read("src/app/(app)/settings/AuditLogTab.tsx");
    expect(tab).toContain('name="from"');
    expect(tab).toContain('name="to"');
    expect(tab).toContain('name="user"');
    expect(tab).toContain('name="entity"');
    expect(tab).toContain("Records are never deleted");
    expect(tab).not.toContain("DiffView");
    // The record cell shows the resolved label, never the raw id.
    expect(tab).toContain("{label ?? ");
  });
});
