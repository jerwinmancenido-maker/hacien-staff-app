"use client";

import { useEffect } from "react";

type SignOutAction = () => void | Promise<void>;

/** Signs the open tab out after idleMs with no pointer, key, or scroll. The server still enforces the same window. */
export function IdleSignOut({ idleMs, signOutAction }: { idleMs: number; signOutAction: SignOutAction }) {
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void signOutAction();
      }, idleMs);
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    for (const name of events) window.addEventListener(name, arm, { passive: true });
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, arm);
    };
  }, [idleMs, signOutAction]);
  return null;
}
