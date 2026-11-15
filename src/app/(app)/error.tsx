// (app) segment error boundary (B-1). Catches errors thrown by pages
// inside the signed-in app (e.g. the Home dashboard load) while the
// layout — sidebar, top bar — stays on screen. Recovery uses Next's
// `retry` prop: refetch from the server, then re-render.

"use client";

import { ErrorRecovery } from "@/components/ErrorRecovery";

export default function AppError({
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
