// Root error boundary (App Router). Rendered in place of the whole app when
// the root layout itself fails, so it cannot use the layout's CSS — inline
// styles only. The error is sent to Sentry (a no-op when no DSN is set).

"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
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
            The page hit an unexpected error. Try again, or go back and continue from where you were.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: "#2563EB",
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
        </main>
      </body>
    </html>
  );
}
