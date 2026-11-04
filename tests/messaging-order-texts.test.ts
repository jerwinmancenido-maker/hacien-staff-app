import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings/defaults";
import {
  firstName,
  orderTextBody,
  orderTextEventKey,
  sendOrderText,
  type OrderTextDedupStore,
  type OrderTextSettings,
} from "@/lib/messaging/order-texts";

const ON: OrderTextSettings = {
  orderTextsEnabled: true,
  orderConfirmed: true,
  orderDelivered: true,
  orderPayment: true,
};
const OFF: OrderTextSettings = {
  orderTextsEnabled: false,
  orderConfirmed: false,
  orderDelivered: false,
  orderPayment: false,
};

function memDedup(): OrderTextDedupStore & { keys: Set<string>; marks: number } {
  const keys = new Set<string>();
  return {
    keys,
    marks: 0,
    async exists(key) {
      return keys.has(key);
    },
    async mark(input) {
      keys.add(input.eventKey);
      this.marks += 1;
    },
  };
}

const recipient = {
  customerName: "Juan Dela Cruz",
  orderTextUpdates: true,
  contactName: "Juan Dela Cruz",
  contactPhone: "09171234567",
};

describe("order text templates (Q16, S-95)", () => {
  it("uses the owner-approved wording, first name + SO number only", () => {
    expect(orderTextBody("confirmed", "Juan", "SO-2026-0001")).toBe(
      "Hi Juan, your order SO-2026-0001 is confirmed. Thank you!",
    );
    expect(orderTextBody("delivered", "Juan", "SO-2026-0001")).toBe(
      "Hi Juan, your order SO-2026-0001 has been delivered. Thank you!",
    );
    expect(orderTextBody("payment", "Juan", "SO-2026-0001")).toBe(
      "Hi Juan, we received payment for your order SO-2026-0001. Thank you!",
    );
    for (const kind of ["confirmed", "delivered", "payment"] as const) {
      const body = orderTextBody(kind, "Juan", "SO-2026-0001");
      expect(body).not.toMatch(/https?:|www\.|₱|2307|balance|amount/i);
    }
  });

  it("takes the first name token, or 'there' when none is on file", () => {
    expect(firstName("Juan Dela Cruz")).toBe("Juan");
    expect(firstName("  Maria  ")).toBe("Maria");
    expect(firstName("")).toBe("there");
    expect(firstName(null)).toBe("there");
  });

  it("defaults all order texts OFF (Default chosen: until UniSMS keys, DPA and sender ID are confirmed)", () => {
    expect(DEFAULT_SETTINGS.messaging).toEqual(OFF);
  });

  it("builds a distinct event key per kind and source", () => {
    expect(orderTextEventKey("confirmed", "so-1")).toBe("confirmed:so-1");
    expect(orderTextEventKey("payment", "col-1")).toBe("payment:col-1");
    expect(orderTextEventKey("payment", "col-1")).not.toBe(orderTextEventKey("payment", "col-2"));
  });
});

describe("order text gating and duplicate prevention", () => {
  it("skips when the master switch, the template, or the customer switch is off — and never calls send", async () => {
    const calls: string[] = [];
    const send = async () => {
      calls.push("sent");
      return { ok: true as const, status: "sent" as const, logId: "log-1" };
    };
    const base = {
      kind: "confirmed" as const,
      salesOrderNumber: "SO-2026-0001",
      salesOrderId: "so-1",
      sourceId: "so-1",
      recipient,
    };
    expect(await sendOrderText(base, { settings: OFF, send, dedup: memDedup() })).toMatchObject({ status: "skipped" });
    expect(
      await sendOrderText(base, { settings: { ...ON, orderConfirmed: false }, send, dedup: memDedup() }),
    ).toMatchObject({ status: "skipped" });
    expect(
      await sendOrderText(
        { ...base, recipient: { ...recipient, orderTextUpdates: false } },
        { settings: ON, send, dedup: memDedup() },
      ),
    ).toMatchObject({ status: "skipped" });
    expect(
      await sendOrderText(
        { ...base, recipient: { ...recipient, contactPhone: "02-1234" } },
        { settings: ON, send, dedup: memDedup() },
      ),
    ).toMatchObject({ status: "skipped" });
    expect(calls).toEqual([]);
  });

  it("sends once, then skips the same event — but a different collection still sends", async () => {
    const dedup = memDedup();
    let calls = 0;
    const send = async () => {
      calls += 1;
      return { ok: true as const, status: "sent" as const, logId: `log-${calls}` };
    };
    const payment = (sourceId: string) => ({
      kind: "payment" as const,
      salesOrderNumber: "SO-2026-0001",
      salesOrderId: "so-1",
      sourceId,
      recipient,
    });
    expect(await sendOrderText(payment("col-1"), { settings: ON, send, dedup })).toMatchObject({ status: "sent" });
    expect(await sendOrderText(payment("col-1"), { settings: ON, send, dedup })).toMatchObject({ status: "skipped" });
    expect(await sendOrderText(payment("col-2"), { settings: ON, send, dedup })).toMatchObject({ status: "sent" });
    expect(calls).toBe(2);
    expect(dedup.marks).toBe(2);
  });

  it("does not mark a failed / not-sent attempt as sent, so an Admin retry stays possible", async () => {
    const dedup = memDedup();
    const send = async () => ({ ok: false as const, status: "failed" as const, error: "Provider down.", logId: "log-1" });
    const input = {
      kind: "confirmed" as const,
      salesOrderNumber: "SO-2026-0001",
      salesOrderId: "so-1",
      sourceId: "so-1",
      recipient,
    };
    expect(await sendOrderText(input, { settings: ON, send, dedup })).toMatchObject({ status: "failed" });
    expect(dedup.marks).toBe(0);
    expect(await dedup.exists("confirmed:so-1")).toBe(false);
  });
});

describe("a failed text never rolls back the order, delivery or payment", () => {
  it("sendOrderText never throws, even when the provider and the dedup store both throw", async () => {
    const throwingSend = async (): Promise<never> => {
      throw new Error("Provider exploded.");
    };
    const throwingDedup: OrderTextDedupStore = {
      async exists() {
        throw new Error("DB exploded.");
      },
      async mark() {
        throw new Error("DB exploded.");
      },
    };
    const input = {
      kind: "delivered" as const,
      salesOrderNumber: "SO-2026-0001",
      salesOrderId: "so-1",
      sourceId: "del-1",
      recipient,
    };
    // No throw here is the point: callers run this AFTER their transaction
    // commits, and a text failure must not undo that committed record.
    const outcome = await sendOrderText(input, { settings: ON, send: throwingSend, dedup: throwingDedup });
    expect(outcome.status).toBe("failed");
    // And a throwing send alone is also contained, not propagated.
    const outcome2 = await sendOrderText(input, {
      settings: ON,
      send: throwingSend,
      dedup: memDedup(),
    });
    expect(outcome2.status).toBe("failed");
  });
});
