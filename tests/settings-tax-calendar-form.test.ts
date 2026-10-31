// Settings → Tax calendar table: Due month only for annual forms; helpers; markup.

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
  obligationUsesDueMonth,
} from "@/lib/tax/calendar-obligations";
import { TaxCalendarForm } from "@/app/(app)/settings/TaxCalendarForm";
import { SettingsForm } from "@/app/(app)/settings/SettingsForm";
import type { FormState } from "@/lib/validation/forms";

const noopAction = async (): Promise<FormState> => ({ ok: true });

const INTRO =
  "Owner-only. Turn forms on or off and edit due days. Dates stay provisional until COR is uploaded and checked. This app never files or pays. Do not add the abolished 0605 fee.";

describe("obligationUsesDueMonth", () => {
  it("is true only for annual_1701 (1701 / 1701A)", () => {
    const annual = TAX_CALENDAR_OBLIGATIONS.filter((d) => obligationUsesDueMonth(d)).map((d) => d.key);
    expect(annual.sort()).toEqual(["1701", "1701a"]);
    for (const def of TAX_CALENDAR_OBLIGATIONS) {
      if (def.schedule.kind === "annual_1701") {
        expect(obligationUsesDueMonth(def)).toBe(true);
      } else {
        expect(obligationUsesDueMonth(def)).toBe(false);
      }
    }
  });
});

describe("obligationDueDayHint", () => {
  it("returns special one-line hints only; generic day/month ranges live in headers", () => {
    for (const def of TAX_CALENDAR_OBLIGATIONS) {
      const hint = obligationDueDayHint(def);
      if (hint == null) {
        expect(["quarterly_1701q", "annual_1701", "quarterly_after_end", "monthly"]).toContain(def.schedule.kind);
        continue;
      }
      expect(hint.includes("\n")).toBe(false);
      expect(hint.toLowerCase()).not.toContain("catalog month rule");
      expect(hint).not.toBe("Day of the month (1–31).");
      expect(hint).not.toBe("Month of the year (1–12).");
    }
    expect(obligationDueDayHint(TAX_CALENDAR_OBLIGATIONS.find((d) => d.key === "2551q")!)).toContain(
      "25 days after quarter end",
    );
  });
});

describe("TaxCalendarForm markup", () => {
  it("renders intro inside the card, COR baseline, header ranges, Due month only for annual", () => {
    const seed = defaultTaxCalendarSettings();
    const html = renderToStaticMarkup(
      createElement(TaxCalendarForm, {
        label: "Tax calendar",
        versionId: "ver-test",
        action: noopAction,
        corUploadedAndChecked: seed.corUploadedAndChecked,
        obligations: seed.obligations,
        intro: INTRO,
      }),
    );

    expect(html).toContain("settings-tax-cal-intro");
    expect(html).toContain(INTRO);
    expect(html).toContain("settings-cor-check");
    expect(html).toContain("COR uploaded and checked");
    expect(html).toContain("tax-cal-settings-table");
    expect(html).toContain(">Form</th>");
    expect(html).toContain(">Show</th>");
    expect(html).toContain(">Due day (1–31)</th>");
    expect(html).toContain(">Due month (1–12)</th>");
    expect(html).not.toContain("Day of the month (1–31).");
    expect(html).not.toContain("Month of the year (1–12).");
    expect(html).toContain("Leave blank to use 25 days after quarter end.");
    expect(html).toContain("tax-cal-hint-row");
    expect(html).toContain('data-hint-for="2551q"');
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
      const uses = obligationUsesDueMonth(def);
      expect(row).toContain(`data-uses-due-month="${uses ? "1" : "0"}"`);
      if (uses) {
        expect(row).toContain(`id="obligations.${def.key}.dueMonth"`);
        expect(row).toContain(`name="obligations.${def.key}.dueMonth"`);
        expect(row).not.toContain("tax-cal-month-na");
        expect(row).toContain('type="number"');
      } else {
        expect(row).toContain(`type="hidden"`);
        expect(row).toContain(`name="obligations.${def.key}.dueMonth"`);
        expect(row).toContain("tax-cal-month-na");
        expect(row).not.toContain(`id="obligations.${def.key}.dueMonth"`);
      }
    }

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
  it("keeps settings page width, form grid collapse, and tax calendar stack rules", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.settings-page\s*\{[^}]*max-width:\s*960px/);
    expect(css).toMatch(/\.form-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.form-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/\.tax-cal-settings-table/);
    expect(css).toMatch(/\.settings-form-actions[^}]*sticky/);
    expect(css).toMatch(/\.pill-tab[^}]*min-height:\s*40px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.pill-tabs-track\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.settings-pill-tabs[\s\S]*\.pill-tabs-arrow[\s\S]*display:\s*none/);
    expect(css).toMatch(/\.settings-notice/);
    expect(css).toMatch(/\.print-collapse-body\.is-collapsed/);
  });
});
