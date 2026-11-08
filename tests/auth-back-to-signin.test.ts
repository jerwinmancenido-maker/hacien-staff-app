import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the auth-pages review (Batch 14, 2026-11-08): two signed-out
// pages were dead ends with no way back to the sign-in page — the
// reset-password expired state and the two-step verify page. Both must
// carry a "Back to sign in" link to /login, like the forgot-password form.
const reset = readFileSync(join(process.cwd(), "src/app/reset-password/page.tsx"), "utf8");
const verify = readFileSync(join(process.cwd(), "src/app/login/verify/page.tsx"), "utf8");

describe("auth pages — back to sign in", () => {
  it("reset-password expired state links back to sign in (and still offers a new link)", () => {
    expect(reset).toContain('<Link href="/login">Back to sign in</Link>');
    expect(reset).toContain('<Link href="/forgot-password">Send a new link</Link>');
  });

  it("two-step verify page links back to sign in", () => {
    expect(verify).toContain('<Link href="/login">Back to sign in</Link>');
  });
});
