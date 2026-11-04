import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notificationBadgeTotal } from "@/lib/notification-types";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("S-57 notifications bell", () => {
  it("badge totals all section counts", () => {
    expect(
      notificationBadgeTotal([
        { key: "a", label: "A", count: 3, href: "/a", items: [] },
        { key: "b", label: "B", count: 0, href: "/b", items: [] },
        { key: "c", label: "C", count: 2, href: "/c", items: [] },
      ]),
    ).toBe(5);
  });

  it("bell covers approvals, overdue, payment reminders and late delivery", () => {
    const lib = src("src/lib/notifications.ts");
    for (const key of ["approvals", "overdue", "due-soon", "late"]) expect(lib).toContain(`key: "${key}"`);
    expect(lib).toContain("arAgingSummary");
    expect(lib).toContain("PARTIALLY_RECEIVED");
  });

  it("layout renders the live bell instead of the dead button", () => {
    const layout = src("src/app/(app)/layout.tsx");
    expect(layout).toContain("NotificationsBell");
    expect(layout).toContain("getNotifications(user)");
    expect(layout).not.toContain('aria-label="Notifications" title="Notifications"');
  });

  it("bell component shows a badge only when there is something to show", () => {
    const bell = src("src/components/NotificationsBell.tsx");
    expect(bell).toContain("notif-badge");
    expect(bell).toContain("Nothing needs attention right now.");
  });
});
