// Tax calendar against MySQL 8 (TEST_DATABASE_URL). Fake data only — no customer PII.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) process.env.DATABASE_URL = url;
  return { hasDb: !!url };
});

import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/permissions";
import { getSettingsSnapshot } from "@/lib/settings";
import { isoDate } from "@/lib/format";
import {
  listTaxCalendar,
  markTaxCalendarDone,
  undoTaxCalendarDone,
} from "@/lib/services/tax-calendar";
import type { DocActor } from "@/lib/services/quotes";
import { makeUser, tag } from "./fixtures";

describe.skipIf(!env.hasDb)("tax calendar (MySQL)", () => {
  let admin: DocActor;
  let staff: DocActor;

  beforeAll(async () => {
    [admin, staff] = await Promise.all([makeUser("costs"), makeUser("staff")]);
    await ensureBooksOn();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureBooksOn() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await getSettingsSnapshot();
      if (snap.settings.features.booksEnabled && snap.settings.taxCalendar) return;
      const latest = await db.settingsVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
      try {
        await db.settingsVersion.create({
          data: {
            version: latest.version + 1 + attempt,
            data: {
              ...snap.settings,
              features: { ...snap.settings.features, booksEnabled: true },
            } as never,
            changedKey: "features",
            before: snap.settings.features,
            after: { ...snap.settings.features, booksEnabled: true },
            createdById: admin.id,
          },
        });
        return;
      } catch {
        // version race
      }
    }
  }

  it("view_books is enforced (Staff forbidden)", async () => {
    await expect(listTaxCalendar(staff, { view: "upcoming" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      markTaxCalendarDone(
        { occurrenceKey: "1701q|2099-Q1", doneDateYmd: "2099-01-01", note: "nope" },
        staff,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("mark as done is audited and can be undone", async () => {
    const year = 2300 + (parseInt(tag().slice(0, 3), 16) % 600);
    const key = `1701q|${year}-Q3`;

    const { id } = await markTaxCalendarDone(
      {
        occurrenceKey: key,
        doneDateYmd: `${year}-11-01`,
        note: "Fake OR note — not a filing",
        dueYmd: `${year}-11-15`,
      },
      admin,
    );
    expect(id).toBeTruthy();

    const audit = await db.auditLog.findFirst({
      where: { entityType: "TaxCalendarCompletion", entityId: id },
      orderBy: { at: "desc" },
    });
    expect(audit?.action).toBe("create");
    expect(JSON.stringify(audit?.after)).toContain("mark_done_note");
    expect(JSON.stringify(audit?.after)).toContain(key);

    const active = await db.taxCalendarCompletion.findFirst({
      where: { occurrenceKey: key, undoneAt: null },
    });
    expect(active).toBeTruthy();
    expect(isoDate(active!.doneDate)).toBe(`${year}-11-01`);
    expect(active!.note).toContain("not a filing");

    await expect(
      markTaxCalendarDone({ occurrenceKey: key, doneDateYmd: `${year}-11-02` }, admin),
    ).rejects.toThrow(/already marked done/i);

    const undone = await undoTaxCalendarDone({ occurrenceKey: key }, admin);
    expect(undone.id).toBe(id);

    const afterUndo = await db.taxCalendarCompletion.findUnique({ where: { id } });
    expect(afterUndo?.undoneAt).toBeTruthy();
    expect(afterUndo?.undoneById).toBe(admin.id);

    const undoAudit = await db.auditLog.findFirst({
      where: { entityType: "TaxCalendarCompletion", entityId: id, action: "update" },
      orderBy: { at: "desc" },
    });
    expect(JSON.stringify(undoAudit?.after)).toContain("undo_mark_done");

    const again = await markTaxCalendarDone(
      { occurrenceKey: key, doneDateYmd: `${year}-11-03`, note: "re-done" },
      admin,
    );
    expect(again.id).not.toBe(id);

    const listed = await listTaxCalendar(admin, {
      view: "all",
      now: new Date(`${year}-10-30T08:00:00.000Z`),
    });
    const row = listed.rows.find((r) => r.occurrenceKey === key);
    expect(row?.markedDone).toBe(true);
    expect(row?.statusLabel).toBe("Marked done");
  });

  it("list returns provisional true until COR checked in settings", async () => {
    const { provisional, rows } = await listTaxCalendar(admin, {
      view: "upcoming",
      now: new Date("2026-10-30T08:00:00.000Z"),
    });
    expect(provisional).toBe(true);
    expect(Array.isArray(rows)).toBe(true);
  });
});
