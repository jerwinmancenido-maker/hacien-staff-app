// Modal portal (final-check finding F2): dialogs rendered inline inside a
// table cell or animated row inherit a stacking context and can paint UNDER
// the page (the Mark 2307 received dialog). Both dialog components must
// render through ModalPortal (createPortal to document.body).

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/docs/Dialogs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("modal portal (F2)", () => {
  it("ModalPortal renders through createPortal into document.body", () => {
    const src = read("src/components/ModalPortal.tsx");
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
  });

  it("both dialog components wrap their backdrop in ModalPortal", () => {
    const dialogs = read("src/components/docs/Dialogs.tsx");
    expect(dialogs).toContain("ModalPortal");
    expect(dialogs).toMatch(/<ModalPortal>\s*<div className=\{variant === "drawer-right" \? "modal-backdrop drawer" : "modal-backdrop"\}/);
    const confirm = read("src/components/ConfirmDialog.tsx");
    expect(confirm).toContain("ModalPortal");
    expect(confirm).toMatch(/<ModalPortal>\s*<div className="modal-backdrop"/);
  });

  it("server-rendering a dialog does not throw (portal defers to the client)", () => {
    const modalHtml = renderToStaticMarkup(
      createElement(Modal, { title: "Test", onClose: () => undefined, labelId: "t" }, createElement("p", null, "Body")),
    );
    expect(modalHtml).toBe("");
    const confirmHtml = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Sure?",
        confirmLabel: "Yes",
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
    expect(confirmHtml).toBe("");
  });
});
