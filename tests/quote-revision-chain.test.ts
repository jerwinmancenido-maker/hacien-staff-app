// Phase 2 #5: revision chain display logic — links both directions,
// a deleted middle revision renders as text, never a dead link (V1/V2).
import { describe, expect, it } from "vitest";
import { buildRevisionChain, type RevisionChainMember } from "@/lib/quotes/revision-chain";

const member = (id: string, revision: number, day: number): RevisionChainMember => ({
  id,
  number: `QT-2026-000${revision}`,
  revision,
  createdAt: new Date(Date.UTC(2026, 10, day)),
});

describe("buildRevisionChain", () => {
  it("V1: Rev 1/2/3 all present link both directions, current marked", () => {
    const members = [member("a", 1, 1), member("b", 2, 2), member("c", 3, 3)];
    const fromFirst = buildRevisionChain("a", members);
    expect(fromFirst).toEqual([
      { kind: "quote", id: "a", number: "QT-2026-0001", revision: 1, isCurrent: true },
      { kind: "quote", id: "b", number: "QT-2026-0002", revision: 2, isCurrent: false },
      { kind: "quote", id: "c", number: "QT-2026-0003", revision: 3, isCurrent: false },
    ]);
    const fromLast = buildRevisionChain("c", members);
    expect(fromLast.map((e) => (e.kind === "quote" ? e.isCurrent : false))).toEqual([false, false, true]);
  });

  it("V2: a deleted middle revision is a text entry, not a link", () => {
    const members = [member("a", 1, 1), member("c", 3, 3)];
    expect(buildRevisionChain("c", members)).toEqual([
      { kind: "quote", id: "a", number: "QT-2026-0001", revision: 1, isCurrent: false },
      { kind: "deleted", revision: 2 },
      { kind: "quote", id: "c", number: "QT-2026-0003", revision: 3, isCurrent: true },
    ]);
  });

  it("a deleted Rev 1 root leaves a leading text entry", () => {
    const members = [member("b", 2, 2), member("c", 3, 3)];
    expect(buildRevisionChain("b", members)[0]).toEqual({ kind: "deleted", revision: 1 });
  });

  it("a lone quote has no chain", () => {
    expect(buildRevisionChain("a", [member("a", 1, 1)])).toEqual([]);
    expect(buildRevisionChain("a", [])).toEqual([]);
  });

  it("two live quotes sharing a revision number both stay links, sorted by creation", () => {
    const members = [member("c", 2, 3), member("a", 1, 1), member("b", 2, 2)];
    const chain = buildRevisionChain("a", members);
    expect(chain.map((e) => (e.kind === "quote" ? e.id : "deleted"))).toEqual(["a", "b", "c"]);
  });
});
