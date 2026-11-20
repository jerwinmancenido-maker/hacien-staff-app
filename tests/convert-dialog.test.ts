import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConvertDialog, type AddressOption } from "@/components/docs/Dialogs";
import type { FormState } from "@/lib/validation/forms";

const onConvert = async (): Promise<FormState> => ({ ok: true });
const onAddAddress = async (): Promise<FormState> => ({ ok: true });

function render(props: Partial<Parameters<typeof ConvertDialog>[0]>) {
  return renderToStaticMarkup(
    createElement(ConvertDialog, {
      number: "QT-2026-0001",
      defaultAddress: "",
      hasAcceptance: true,
      onClose: () => {},
      onConvert,
      ...props,
    }),
  );
}

describe("ConvertDialog delivery address path", () => {
  it("offers an inline add-address path when the customer has no saved addresses", () => {
    const html = render({ addressOptions: [], customerName: "Acme Corp", onAddAddress });
    expect(html).toContain("+ Add new address");
    expect(html).toContain("no saved addresses yet");
    // The old dead end told staff to leave and edit the customer first.
    expect(html).not.toContain("before converting to a sales order");
  });

  it("keeps the old guidance when no add-address action is wired", () => {
    const html = render({ addressOptions: [] });
    expect(html).toContain("Add an address to the customer before converting to a sales order.");
    expect(html).not.toContain("+ Add new address");
  });

  it("lists saved addresses and still offers to add another", () => {
    const options: AddressOption[] = [
      { id: "addr-1", label: "Delivery · Warehouse: 12 Rizal St., Pasig", text: "12 Rizal St.\nPasig" },
    ];
    const html = render({ addressOptions: options, customerName: "Acme Corp", onAddAddress });
    expect(html).toContain("Delivery · Warehouse: 12 Rizal St., Pasig");
    expect(html).toContain("+ Add new address");
    expect(html).not.toContain("no saved addresses yet");
  });
});
