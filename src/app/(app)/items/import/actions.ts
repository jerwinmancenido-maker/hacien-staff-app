"use server";

// Phase 4 #4: CSV import actions. One action, two intents (preview /
// confirm). Both require edit_data AND the itemsImportEnabled flag —
// route and actions refuse when the flag is off. The confirm never
// trusts the preview: the service re-parses and re-validates the
// submitted CSV text inside its transaction.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireActionPermission } from "@/lib/auth/current-user";
import { isItemsImportEnabled } from "@/lib/items/import-enabled";
import type { ItemsImportActionState } from "@/lib/items/import-shared";
import { confirmItemsImport, previewItemsImport } from "@/lib/items/import-service";
import { str } from "@/lib/validation/forms";

const FLAG_OFF_MESSAGE = "CSV import is not turned on. An admin can enable it in Settings → Features.";

export async function importItemsAction(_prev: ItemsImportActionState, form: FormData): Promise<ItemsImportActionState> {
  try {
    const user = await requireActionPermission("edit_data");
    if (!(await isItemsImportEnabled())) return { stage: "upload", message: FLAG_OFF_MESSAGE };

    const intent = str(form, "intent");
    if (intent === "confirm") {
      const csvText = str(form, "csvText");
      const excludedLines = str(form, "excludedLines")
        .split(",")
        .map((v) => Number.parseInt(v, 10))
        .filter((n) => Number.isInteger(n) && n >= 2);
      const result = await confirmItemsImport(csvText, user.id, excludedLines);
      if (result.ok) {
        revalidatePath("/items");
        return {
          stage: "done",
          count: result.count,
          batchId: result.batchId,
          message: `Imported ${result.count} item${result.count === 1 ? "" : "s"} into the catalog.`,
        };
      }
      return {
        stage: "preview",
        csvText,
        excludedLines,
        rows: result.rows,
        fileError: result.fileError,
        nonce: randomUUID(),
        message: result.fileError
          ? "Nothing was imported — the file no longer passes the checks below."
          : "Nothing was imported — some rows changed since the preview (for example, an item with the same SKU was just added). Fix or remove the rows marked below, then confirm again.",
      };
    }

    // Default intent: preview an uploaded file.
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { stage: "upload", message: "Choose a .csv file first." };
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return { stage: "upload", message: "Only .csv files are supported — in Excel, use Save As → CSV, then upload that file." };
    }
    const csvText = await file.text();
    const preview = await previewItemsImport(csvText);
    return {
      stage: "preview",
      fileName: file.name,
      csvText,
      rows: preview.rows,
      fileError: preview.fileError,
      excludedLines: [],
      nonce: randomUUID(),
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { stage: "upload", message: e.message };
    throw e;
  }
}
