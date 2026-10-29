import Link from "next/link";
import { findValidToken } from "@/lib/services/users";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const row = await findValidToken(token);
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-logo">H</span>
          <span>HACIEN</span>
        </div>
        <h1>{row?.purpose === "INVITE" ? "Set your password" : "New password"}</h1>
        {row ? (
          <>
            <div className="subtitle">For {row.user.email}. Use at least 10 characters.</div>
            <ResetForm token={token} />
          </>
        ) : (
          <>
            <div className="alert error">This link has expired or was already used. Ask for a new one.</div>
            <div className="links">
              <Link href="/forgot-password">Send a new link</Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
