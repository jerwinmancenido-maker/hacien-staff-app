// Root segment error boundary (B-1). Catches errors thrown by route
// segments under the root layout (including the (app) layout itself)
// without dropping all the way to global-error. Recovery uses Next's
// `retry` prop — refetch from the server, then re-render — so a
// transient failure is a one-click recovery instead of a dead end.

"use client";

import { ErrorRecovery } from "@/components/ErrorRecovery";

export default function RootError({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} retry={retry} />;
}
