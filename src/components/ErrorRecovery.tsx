// Shared body for the app's error boundaries (B-1).
//
// Why this exists: the old error screen's "Try again" called only
// `reset()`, which re-renders the SAME failed server data — it can never
// recover from a transient failure (a brief database connection blip on
// first load is the proven trigger). Next passes a `retry` prop that
// refetches from the server first (router.refresh() + reset()); that is
// the recovery path. A plain reload button is the fallback, and the
// error digest + time are shown so a staff member's screenshot can be
// matched to the server log line (see src/lib/request-error-log.ts).
//
// Inline styles only: global-error.tsx renders this in place of the
// whole app, where the layout's CSS is not available.

"use client";

import * as Sentry from "@sentry/nextjs";
import { BRAND_BLUE } from "@/lib/brand";
import { TIME_ZONE } from "@/lib/format";
import { useEffect, useRef } from "react";

export function ErrorRecovery({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // Client-side clock, written straight to the DOM after mount so server
  // and client markup agree (no state, no hydration mismatch).
  const timeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (timeRef.current) {
      timeRef.current.textContent = new Date().toLocaleString("en-PH", {
        timeZone: TIME_ZONE,
      });
    }
  }, []);

  // retry refetches from the server before re-rendering; when a boundary
  // does not receive it, fall back to reset (previous behaviour).
  const recover = retry ?? reset;

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "10vh auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        color: "#111",
      }}
    >
      <h1 style={{ fontSize: 24 }}>Something went wrong.</h1>
      <p style={{ color: "#555" }}>
        The page hit an unexpected error. Try again — the app fetches a
        fresh copy of the page from the server. If it keeps failing, reload
        the page, or go back and continue from where you were.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => recover()}
          style={{
            background: BRAND_BLUE,
            color: "#fff",
            border: 0,
            borderRadius: 6,
            padding: "10px 16px",
            cursor: "pointer",
            fontSize: 15,
          }}
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: "#fff",
            color: "#111",
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: "10px 16px",
            cursor: "pointer",
            fontSize: 15,
          }}
        >
          Reload page
        </button>
      </div>
      <p style={{ color: "#888", fontSize: 13, marginTop: 16 }}>
        {error.digest ? <>Error ref: {error.digest} · </> : null}
        <span ref={timeRef} /> (Manila)
      </p>
    </main>
  );
}
