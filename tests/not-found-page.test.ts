// Finding 1105 pin: the branded 404. Before this, the app had no
// not-found.tsx, so bad URLs rendered the bare framework-default page.
// The pin: the root not-found renders the app's branded standalone
// surface — official brand logo, the plain "Page not found" heading,
// and one pill recovery action — and never the framework default's
// text or the unapproved draft-1 tagline.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode; [k: string]: unknown }) =>
    createElement("a", { href, ...rest }, children),
}));

import NotFound from "@/app/not-found";

describe("branded 404 (finding 1105)", () => {
  const html = renderToStaticMarkup(createElement(NotFound));

  it("renders the plain heading and the pill recovery action home", () => {
    expect(html).toContain("Page not found");
    expect(html).toContain("href=\"/\"");
    expect(html).toContain("Back to Home");
    expect(html).toContain("class=\"btn\"");
  });

  it("carries the brand (official logo on the auth-card surface)", () => {
    expect(html).toContain("/brand/logo-full.svg");
    expect(html).toContain("auth-card");
  });

  it("is not the framework-default page and carries no unapproved copy", () => {
    expect(html).not.toContain("This page could not be found");
    expect(html).not.toContain("documented properly");
  });
});
