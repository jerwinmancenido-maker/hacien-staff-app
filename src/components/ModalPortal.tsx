"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children at document.body. Modal backdrops rendered inline inherit
 * their ancestors' stacking contexts — a dialog opened from inside a table
 * cell or an animated list row can end up painted UNDER the page content
 * (final-check finding F2: the Mark 2307 received dialog). Portaling to the
 * body puts the backdrop in the root stacking context, above the page.
 *
 * Before mount (server render, first client paint) the children render
 * inline: dialogs only open after a user action, which always happens after
 * mount, so the portal is in place before any dialog can appear — and
 * server-rendered markup (and render tests) still see the dialog content.
 * useSyncExternalStore gives the mounted flag without an effect: false for
 * the server snapshot, true on the client.
 */
const subscribe = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ModalPortal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  if (!mounted) return <>{children}</>;
  return createPortal(children, document.body);
}
