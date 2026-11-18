"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children at document.body. Modal backdrops rendered inline inherit
 * their ancestors' stacking contexts — a dialog opened from inside a table
 * cell or an animated list row can end up painted UNDER the page content
 * (final-check finding F2: the Mark 2307 received dialog). Portaling to the
 * body puts the backdrop in the root stacking context, above the page.
 * Modals only open after a user action (post-hydration), so there is no
 * server-rendered content to mismatch; the guard covers SSR just in case.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
