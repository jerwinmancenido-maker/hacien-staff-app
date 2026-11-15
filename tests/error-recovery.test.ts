// B-1: the error boundaries. The old global-error's "Try again" called
// reset() only, which re-renders the same failed server data — recovery
// was impossible. These renders pin the recovery surface every boundary
// must offer: a Try again (wired to Next's retry prop in the components),
// a Reload page fallback, and the error digest on screen so a screenshot
// can be matched to the server log line.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GlobalError from "../src/app/global-error";
import RootError from "../src/app/error";
import AppError from "../src/app/(app)/error";
import { ErrorRecovery } from "../src/components/ErrorRecovery";

const err = Object.assign(new Error("boom"), { digest: "DIGEST-42" });
const noop = () => {};

function expectRecoverySurface(html: string) {
  expect(html).toContain("Something went wrong.");
  expect(html).toContain("Try again");
  expect(html).toContain("Reload page");
  expect(html).toContain("Error ref: DIGEST-42");
}

describe("error boundaries render the recovery surface", () => {
  it("shared ErrorRecovery body", () => {
    expectRecoverySurface(
      renderToStaticMarkup(
        createElement(ErrorRecovery, { error: err, reset: noop, retry: noop }),
      ),
    );
  });

  it("global-error (whole-app replacement)", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: err, reset: noop, retry: noop }),
    );
    expect(html).toContain("<html");
    expectRecoverySurface(html);
  });

  it("root segment error.tsx", () => {
    expectRecoverySurface(
      renderToStaticMarkup(
        createElement(RootError, { error: err, reset: noop, retry: noop }),
      ),
    );
  });

  it("(app) segment error.tsx", () => {
    expectRecoverySurface(
      renderToStaticMarkup(
        createElement(AppError, { error: err, reset: noop, retry: noop }),
      ),
    );
  });

  it("renders without a digest (ref line omitted, buttons still shown)", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorRecovery, {
        error: new Error("no digest"),
        reset: noop,
        retry: noop,
      }),
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("Error ref:");
  });
});
