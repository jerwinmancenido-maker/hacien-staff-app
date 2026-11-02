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
  markTaxCalendarFiled,
  undoTaxCalendarFiled,
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

  it("Admin marks filed with reference number and attachment; undo is Admin-only and logged", async () => {
    const year = 2400 + (parseInt(tag().slice(0, 3), 16) % 500);
    const key = `1701q|${year}-Q3`;

    // Non-admin (staff) cannot mark filed
    await expect(
      markTaxCalendarFiled(
        {
          occurrenceKey: key,
          filedDateYmd: `${year}-11-03`,
          referenceNo: "TEST-REF-001",
          file: {
            name: "efps_confirmation.pdf",
            size: 15,
            bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xd0, 0xd4, 0xc5, 0xd8, 0x0a]),
          },
        },
        staff,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Admin can mark filed
    const { id } = await markTaxCalendarFiled(
      {
        occurrenceKey: key,
        filedDateYmd: `${year}-11-03`,
        referenceNo: "TEST-REF-001",
        file: {
          name: "efps_confirmation.pdf",
          size: 15,
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xd0, 0xd4, 0xc5, 0xd8, 0x0a]),
        },
      },
      admin,
    );
    expect(id).toBeTruthy();

    const row = await db.taxCalendarCompletion.findUnique({
      where: { id },
      include: { attachments: true },
    });
    expect(row).toBeTruthy();
    expect(row?.referenceNo).toBe("TEST-REF-001");
    expect(row?.attachments).toHaveLength(1);
    expect(row?.attachments[0]?.fileName).toBe("efps_confirmation.pdf");

    // Non-admin cannot undo
    await expect(
      undoTaxCalendarFiled({ occurrenceKey: key, reason: "Wrong ref" }, staff),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Admin undoes with reason
    await undoTaxCalendarFiled({ occurrenceKey: key, reason: "Wrong ref" }, admin);

    const undoneRow = await db.taxCalendarCompletion.findUnique({ where: { id } });
    expect(undoneRow?.undoneAt).toBeTruthy();
    expect(undoneRow?.undoneById).toBe(admin.id);
    expect(undoneRow?.voidedAt).toBeTruthy();
    expect(undoneRow?.voidReason).toBe("Wrong ref");

    const undoAudit = await db.auditLog.findFirst({
      where: { entityType: "TaxCalendarCompletion", entityId: id, action: "void" },
      orderBy: { at: "desc" },
    });
    expect(undoAudit).toBeTruthy();
    expect(JSON.stringify(undoAudit?.after)).toContain("undo_filed");
    expect(JSON.stringify(undoAudit?.after)).toContain("Wrong ref");
  });
});
