import { describe, expect, it } from "vitest";
import {
  BOOKLET_DOC_TYPES,
  BOOKLET_TYPES,
  bookletGrid,
  bookletLowStockWarning,
  bookletRangeError,
  formatBookletNumber,
  inBookletRange,
  parseBookletSerial,
  type BookletRange,
} from "@/lib/billing/booklet";
import { settingsSchema } from "@/lib/settings/schema";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";

describe("BIR pre-printed booklet (ATP) tracking", () => {
  const range: BookletRange = {
    seriesFrom: 1,
    seriesTo: 500,
    atpNo: "TEST-ATP-0001",
    atpDate: "2026-10-22",
    printer: "CEPRINTS EMPIRE INC",
    bookletCount: 10,
    setsPerBooklet: 50,
    isNonVat: true,
  };

  describe("range check (0, 1, 500, 501)", () => {
    it("0 is out of range", () => {
      expect(inBookletRange(0, range)).toBe(false);
      expect(bookletRangeError(0, range, "SI")).toMatch(/whole/);
    });

    it("1 is in range", () => {
      expect(inBookletRange(1, range)).toBe(true);
      expect(bookletRangeError(1, range, "SI")).toBeNull();
    });

    it("500 is in range", () => {
      expect(inBookletRange(500, range)).toBe(true);
      expect(bookletRangeError(500, range, "SI")).toBeNull();
    });

    it("501 is out of range", () => {
      expect(inBookletRange(501, range)).toBe(false);
      const err = bookletRangeError(501, range, "SI");
      expect(err).toContain("SI no. 501 is outside the booklet range 001-500");
    });
  });

  describe("3-digit padded serial display", () => {
    it("formats numbers with 3-digit padding", () => {
      expect(formatBookletNumber(1)).toBe("001");
      expect(formatBookletNumber(7)).toBe("007");
      expect(formatBookletNumber(50)).toBe("050");
      expect(formatBookletNumber(500)).toBe("500");
      expect(formatBookletNumber(501)).toBe("501");
    });
  });

  describe("low-stock threshold (450 used -> warning at 50 left; 449 used -> none)", () => {
    it("warns when 50 or fewer are left (450 used out of 500)", () => {
      const freeCount = 500 - 450; // 50
      expect(freeCount).toBe(50);
      const warning = bookletLowStockWarning("Sales Invoice", freeCount);
      expect(warning).toBe("Sales Invoice booklet running low");
    });

    it("does not warn when more than 50 are left (449 used out of 500)", () => {
      const freeCount = 500 - 449; // 51
      expect(freeCount).toBe(51);
      const warning = bookletLowStockWarning("Sales Invoice", freeCount);
      expect(warning).toBeNull();
    });

    it("warns per document type name", () => {
      expect(bookletLowStockWarning("Delivery Receipt", 50)).toBe("Delivery Receipt booklet running low");
      expect(bookletLowStockWarning("Collection Receipt", 50)).toBe("Collection Receipt booklet running low");
    });

    it("grid calculates low-stock warning accurately", () => {
      // 450 used
      const used450 = Array.from({ length: 450 }, (_, i) => ({
        invoiceNo: i + 1,
        id: `b-${i + 1}`,
        number: `BL-${i + 1}`,
        status: "POSTED",
      }));
      const g50Left = bookletGrid(range, used450, [], "Sales Invoice");
      expect(g50Left.freeCount).toBe(50);
      expect(g50Left.warning).toBe("Sales Invoice booklet running low");

      // 449 used
      const used449 = Array.from({ length: 449 }, (_, i) => ({
        invoiceNo: i + 1,
        id: `b-${i + 1}`,
        number: `BL-${i + 1}`,
        status: "POSTED",
      }));
      const g51Left = bookletGrid(range, used449, [], "Sales Invoice");
      expect(g51Left.freeCount).toBe(51);
      expect(g51Left.warning).toBeNull();
    });
  });

  describe("next-free skips used+spoiled with no duplicate and no skipped serial", () => {
    it("skips used, voided, and spoiled numbers in sequence", () => {
      // 001 is used
      // 002 is spoiled
      // 003 is voided
      // Next free must be 004
      const used = [
        { invoiceNo: 1, id: "b1", number: "BL-001", status: "OPEN" },
        { invoiceNo: 3, id: "b3", number: "BL-003", status: "VOID" },
      ];
      const spoiled = [{ number: 2, id: "sp2", reason: "Paper jam" }];

      const g = bookletGrid(range, used, spoiled, "Sales Invoice");
      expect(g.slots[0]!.status).toBe("used");
      expect(g.slots[1]!.status).toBe("spoiled");
      expect(g.slots[2]!.status).toBe("voided");
      expect(g.slots[3]!.status).toBe("free");

      expect(g.nextFree).toBe(4);
      expect(g.usedCount).toBe(1);
      expect(g.spoiledCount).toBe(1);
      expect(g.voidedCount).toBe(1);
      expect(g.freeCount).toBe(500 - 3);
    });

    it("voided billings numbers stay used (never reused)", () => {
      const used = [{ invoiceNo: 1, id: "b1", number: "BL-001", status: "VOID" }];
      const g = bookletGrid(range, used, [], "Sales Invoice");
      expect(g.slots[0]!.status).toBe("voided");
      expect(g.nextFree).toBe(2);
      expect(g.freeCount).toBe(499);
    });
  });

  describe("three types counted separately", () => {
    it("has 3 booklet types: SI, DR, CR", () => {
      expect(BOOKLET_TYPES).toEqual(["SI", "DR", "CR"]);
      expect(BOOKLET_DOC_TYPES.SI.label).toBe("Sales Invoice");
      expect(BOOKLET_DOC_TYPES.DR.label).toBe("Delivery Receipt");
      expect(BOOKLET_DOC_TYPES.CR.label).toBe("Collection Receipt");
    });

    it("counts each type independently in booklet grids", () => {
      const rangeSI: BookletRange = { seriesFrom: 1, seriesTo: 500 };
      const rangeDR: BookletRange = { seriesFrom: 1, seriesTo: 500 };
      const rangeCR: BookletRange = { seriesFrom: 1, seriesTo: 500 };

      // SI has 450 used -> low stock warning
      const siUsed = Array.from({ length: 450 }, (_, i) => ({
        invoiceNo: i + 1,
        id: `si-${i + 1}`,
        number: `BL-${i + 1}`,
        status: "OPEN",
      }));
      // DR has 10 used -> no warning
      const drUsed = Array.from({ length: 10 }, (_, i) => ({
        invoiceNo: i + 1,
        id: `dr-${i + 1}`,
        number: `DR-${i + 1}`,
        status: "RECORDED",
      }));
      // CR has 455 used/spoiled -> warning
      const crUsed = Array.from({ length: 455 }, (_, i) => ({
        invoiceNo: i + 1,
        id: `cr-${i + 1}`,
        number: `CR-${i + 1}`,
        status: "POSTED",
      }));

      const gridSI = bookletGrid(rangeSI, siUsed, [], "Sales Invoice");
      const gridDR = bookletGrid(rangeDR, drUsed, [], "Delivery Receipt");
      const gridCR = bookletGrid(rangeCR, crUsed, [], "Collection Receipt");

      expect(gridSI.freeCount).toBe(50);
      expect(gridSI.warning).toBe("Sales Invoice booklet running low");

      expect(gridDR.freeCount).toBe(490);
      expect(gridDR.warning).toBeNull();

      expect(gridCR.freeCount).toBe(45);
      expect(gridCR.warning).toBe("Collection Receipt booklet running low");
    });
  });

  describe("parseBookletSerial", () => {
    it("accepts plain digits and optional SI/DR/CR prefix", () => {
      expect(parseBookletSerial("7")).toBe(7);
      expect(parseBookletSerial("007")).toBe(7);
      expect(parseBookletSerial("DR-007")).toBe(7);
      expect(parseBookletSerial("dr 42")).toBe(42);
      expect(parseBookletSerial("CR001")).toBe(1);
    });

    it("rejects mixed OR text and collapsed hyphen patterns", () => {
      expect(parseBookletSerial("12-3")).toBeNull();
      expect(parseBookletSerial("OR-ABC-12")).toBeNull();
      expect(parseBookletSerial("DR-SC-100")).toBeNull();
      expect(parseBookletSerial("DR-2026-0042")).toBeNull();
      expect(parseBookletSerial("")).toBeNull();
    });
  });

  describe("Settings schema for invoiceBooklet per doc type", () => {
    it("rejects nested series where end is before start", () => {
      const bad = {
        ...DEFAULT_SETTINGS,
        invoiceBooklet: {
          ...DEFAULT_SETTINGS.invoiceBooklet,
          deliveryReceipt: {
            ...DEFAULT_SETTINGS.invoiceBooklet.deliveryReceipt,
            seriesFrom: 100,
            seriesTo: 50,
          },
        },
      };
      const parsed = settingsSchema.safeParse(bad);
      expect(parsed.success).toBe(false);
    });

    it("validates and defaults per document type configuration", () => {
      const parsed = settingsSchema.parse(DEFAULT_SETTINGS);
      expect(parsed.invoiceBooklet.salesInvoice).toBeDefined();
      expect(parsed.invoiceBooklet.deliveryReceipt).toBeDefined();
      expect(parsed.invoiceBooklet.collectionReceipt).toBeDefined();

      expect(parsed.invoiceBooklet.salesInvoice.seriesFrom).toBe(1);
      expect(parsed.invoiceBooklet.salesInvoice.seriesTo).toBe(500);
      expect(parsed.invoiceBooklet.salesInvoice.bookletCount).toBe(10);
      expect(parsed.invoiceBooklet.salesInvoice.setsPerBooklet).toBe(50);
      expect(parsed.invoiceBooklet.salesInvoice.isNonVat).toBe(true);
      expect(parsed.invoiceBooklet.salesInvoice.atpNo).toBe("");

      // Accepts Admin input values
      const adminConfig = {
        ...DEFAULT_SETTINGS,
        invoiceBooklet: {
          ...DEFAULT_SETTINGS.invoiceBooklet,
          salesInvoice: {
            atpNo: "TEST-ATP-0001",
            atpDate: "2026-10-22",
            printer: "CEPRINTS EMPIRE INC",
            seriesFrom: 1,
            seriesTo: 500,
            bookletCount: 10,
            setsPerBooklet: 50,
            isNonVat: true,
          },
          deliveryReceipt: {
            atpNo: "TEST-ATP-0002",
            atpDate: "2026-10-22",
            printer: "CEPRINTS EMPIRE INC",
            seriesFrom: 1,
            seriesTo: 500,
            bookletCount: 10,
            setsPerBooklet: 50,
            isNonVat: true,
          },
          collectionReceipt: {
            atpNo: "TEST-ATP-0003",
            atpDate: "2026-10-22",
            printer: "CEPRINTS EMPIRE INC",
            seriesFrom: 1,
            seriesTo: 500,
            bookletCount: 10,
            setsPerBooklet: 50,
            isNonVat: true,
          },
        },
      };

      const parsedAdmin = settingsSchema.parse(adminConfig);
      expect(parsedAdmin.invoiceBooklet.salesInvoice.atpNo).toBe("TEST-ATP-0001");
      expect(parsedAdmin.invoiceBooklet.salesInvoice.printer).toBe("CEPRINTS EMPIRE INC");
      expect(parsedAdmin.invoiceBooklet.salesInvoice.isNonVat).toBe(true);
    });
  });
});
