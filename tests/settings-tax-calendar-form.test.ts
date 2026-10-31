// Settings → Tax calendar: every row edits due day + due month; main wording/hints.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams("tab=tax-calendar"),
}));

import {
  TAX_CALENDAR_OBLIGATIONS,
  defaultTaxCalendarSettings,
  obligationDueDayHint,
  obligationDueMonthHint,
  obligationUsesDueMonth,
} from "@/lib/tax/calendar-obligations";
import { TAX_CALENDAR_PROVISIONAL_BANNER } from "@/lib/tax/calendar-constants";
import { TaxCalendarForm } from "@/app/(app)/settings/TaxCalendarForm";
import { SettingsForm } from "@/app/(app)/settings/SettingsForm";
import type { FormState } from "@/lib/validation/forms";

const noopAction = async (): Promise<FormState> => ({ ok: true });

const INTRO =
  "Owner-only. Turn obligations on or off and edit due days. Dates are provisional until the COR is uploaded and checked. This never files or pays anything. Do not add the abolished 0605 fee.";

const COR_HINT = `When off, the calendar shows: “${TAX_CALENDAR_PROVISIONAL_BANNER}”`;

describe("obligationUsesDueMonth", () => {
  it("is true for every catalog row (including undated_year_end / inventory)", () => {
    for (const def of TAX_CALENDAR_OBLIGATIONS) {
      expect(obligationUsesDueMonth(def)).toBe(true);
    }
    expect(TAX_CALENDAR_OBLIGATIONS.some((d) => d.schedule.kind === "undated_year_end")).toBe(true);
  });
});

describe("obligation due-day / due-month hints (main wording)", () => {
  it("matches main field hints for each schedule kind", () => {
    expect(obligationDueMonthHint()).toBe(
      "1–12. Used for 1701 annual and year-end items; leave blank otherwise.",
    );
    for (const def of TAX_CALENDAR_OBLIGATIONS) {
      const hint = obligationDueDayHint(def);
      if (def.schedule.kind === "undated_year_end") {
        expect(hint).toBe(
          "Leave blank for “date to confirm”. Set day (and month below) once RDO confirms.",
        );
      } else if (def.schedule.kind === "quarterly_last_day_after") {
        expect(hint).toBe("Leave blank to use the last day of the month after the quarter.");
      } else {
        expect(hint).toBe("1–31. Used with the catalog month rule for this form.");
      }
    }
  });
});

describe("TaxCalendarForm markup", () => {
  it("renders intro, COR banner hint, sourceNotes, and editable due day/month for every row", () => {
    const seed = defaultTaxCalendarSettings();
    // Prove undated inventory can carry confirmed month/day overrides in settings shape.
    seed.obligations.inventory_list = { enabled: true, dueDay: 15, dueMonth: 1 };

    const html = renderToStaticMarkup(
      createElement(TaxCalendarForm, {
        label: "Tax calendar",
        versionId: "ver-test",
        action: noopAction,
        corUploadedAndChecked: seed.corUploadedAndChecked,
        obligations: seed.obligations,
        intro: INTRO,
        corHint: COR_HINT,
      }),
    );

    expect(html).toContain("settings-tax-cal-intro");
    expect(html).toContain(INTRO);
    expect(html).toContain("settings-cor-check");
    expect(html).toContain("COR uploaded and checked");
    expect(html).toContain(TAX_CALENDAR_PROVISIONAL_BANNER);
    expect(html).toContain("tax-cal-settings-table");
    expect(html).toContain(">Form</th>");
    expect(html).toContain(">Show</th>");
    expect(html).toContain(">Due day (1–31)</th>");
    expect(html).toContain(">Due month (1–12)</th>");
    expect(html).toContain(obligationDueMonthHint());
    expect(html).toContain(
      "Leave blank for “date to confirm”. Set day (and month below) once RDO confirms.",
    );
    expect(html).toContain("1–31. Used with the catalog month rule for this form.");
    expect(html).toContain("settings-form-actions");
    expect(html).toContain("Save changes");

    // App defaults: 2551Q and 2550Q Show ON (not a seed override).
    expect(seed.obligations["2551q"].enabled).toBe(true);
    expect(seed.obligations["2550q"].enabled).toBe(true);

    for (const def of TAX_CALENDAR_OBLIGATIONS) {
      const rowMatch = html.match(
        new RegExp(`<tr data-obligation="${def.key}"[^>]*>[\\s\\S]*?</tr>`),
      );
      expect(rowMatch, `row for ${def.key}`).toBeTruthy();
      const row = rowMatch![0];
      expect(row).toContain(`data-uses-due-month="1"`);
      expect(row).toContain(`data-schedule="${def.schedule.kind}"`);

      // Show + sourceNote restored on every row.
      expect(row).toContain(`name="obligations.${def.key}.enabled"`);
      expect(row).toContain("tax-cal-source-note");
      expect(row).toContain(def.sourceNote);

      // Due day + due month are real number inputs (submit-able), never month-na stubs.
      expect(row).toContain(`id="obligations.${def.key}.dueDay"`);
      expect(row).toContain(`name="obligations.${def.key}.dueDay"`);
      expect(row).toContain(`id="obligations.${def.key}.dueMonth"`);
      expect(row).toContain(`name="obligations.${def.key}.dueMonth"`);
      expect(row).not.toContain("tax-cal-month-na");
      expect(row).toMatch(
        new RegExp(
          `<input[^>]*id="obligations\\.${def.key}\\.dueDay"[^>]*type="number"|<input[^>]*type="number"[^>]*id="obligations\\.${def.key}\\.dueDay"`,
        ),
      );
      expect(row).toMatch(
        new RegExp(
          `<input[^>]*id="obligations\\.${def.key}\\.dueMonth"[^>]*type="number"|<input[^>]*type="number"[^>]*id="obligations\\.${def.key}\\.dueMonth"`,
        ),
      );
      expect(row.match(/type="number"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    }

    // Inventory (undated_year_end) still renders saved month/day values.
    const inv = html.match(/<tr data-obligation="inventory_list"[^>]*>[\s\S]*?<\/tr>/)![0];
    expect(inv).toContain('data-schedule="undated_year_end"');
    expect(inv).toContain('name="obligations.inventory_list.dueDay"');
    expect(inv).toContain('value="15"');
    expect(inv).toContain('name="obligations.inventory_list.dueMonth"');
    expect(inv).toContain('value="1"');

    expect(html).toContain("1701Q Quarterly income tax");
    expect(html).toContain("1701A Annual income tax");
  });
});

describe("SettingsForm layout helpers", () => {
  it("uses label-above fields, sticky save actions, and no empty label spacer for checkboxes", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsForm, {
        title: "Features",
        label: "Features",
        versionId: "ver-test",
        action: noopAction,
        fields: [
          {
            name: "cashEnabled",
            label: "Enable Cash",
            kind: "checkbox",
            value: false,
            hint: "OFF by default.",
          },
          {
            name: "marginBelowPct",
            label: "Margin below",
            kind: "number",
            value: 18,
            suffix: "%",
          },
        ],
      }),
    );
    expect(html).toContain("settings-section");
    expect(html).toContain("settings-section-title");
    expect(html).toContain("settings-form-actions");
    expect(html).toContain("field-check");
    expect(html).not.toContain("&nbsp;");
    expect(html).toContain('for="marginBelowPct"');
    expect(html).toContain("Margin below");
    expect(html).toContain("field-control-row");
  });
});

describe("settings layout CSS contracts", () => {
  it("scopes form-grid / pill-tab mobile rules to Settings and keeps ≥11px tax-cal/print headers", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.settings-page\s*\{[^}]*max-width:\s*960px/);
    expect(css).toMatch(/\.settings-page\s+\.form-grid|\.settings-shell\s+\.form-grid/);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*768px\)[\s\S]*\.settings-page\s+\.form-grid[\s\S]*grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(/\.tax-cal-settings-table/);
    expect(css).toMatch(/\.tax-cal-settings-table\s+th\s*\{[^}]*font-size:\s*11px/);
    expect(css).toMatch(/\.settings-form-actions[^}]*sticky/);
    expect(css).toMatch(/\.settings-pill-tabs[\s\S]*\.pill-tab[\s\S]*min-height:\s*40px/);
    expect(css).toMatch(/\.settings-pill-tabs[\s\S]*\.pill-tabs-arrow[\s\S]*display:\s*none/);
    expect(css).toMatch(/\.settings-notice/);
    expect(css).toMatch(/\.print-collapse-body\.is-collapsed/);
    expect(css).toMatch(/\.print-company-preview\s*>\s*\.pp-label\s*\{[^}]*font-size:\s*11px/);
  });
});
