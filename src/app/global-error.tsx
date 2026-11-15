// Root error boundary (App Router). Rendered in place of the whole app when
// the root layout itself fails, so it cannot use the layout's CSS — the
// shared ErrorRecovery body uses inline styles only. The error is sent to
// Sentry (a no-op when no DSN is set).
//
// "Try again" uses Next's `retry` prop (refetch from the server, then
// re-render) instead of the old `reset()`-only button, which re-rendered
// the same failed data and could never recover (B-1).

"use client";

import { ErrorRecovery } from "@/components/ErrorRecovery";

export default function GlobalError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorRecovery error={error} reset={reset} retry={retry} />
      </body>
    </html>
  );
}
