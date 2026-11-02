"use client";

import { useEffect } from "react";

type SignOutAction = () => void | Promise<void>;
type RemainingMs = () => Promise<number>;

/**
 * After a quiet spell, ask the server how much idle time is left. Another tab's
 * work keeps the shared session, so this tab only signs out when the server
 * deadline has actually passed.
 */
export function IdleSignOut({
  idleMs,
  signOutAction,
  remainingMs,
}: {
  idleMs: number;
  signOutAction: SignOutAction;
  remainingMs: RemainingMs;
}) {
  useEffect(() => {
    let timer = 0;
    let cancelled = false;
    const arm = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void (async () => {
          const left = await remainingMs();
          if (cancelled) return;
          if (left > 0) arm(left);
          else void signOutAction();
        })();
      }, ms);
    };
    const onActivity = () => arm(idleMs);
    const events = ["pointerdown", "keydown", "scroll"] as const;
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    arm(idleMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, onActivity);
    };
  }, [idleMs, remainingMs, signOutAction]);
  return null;
}
