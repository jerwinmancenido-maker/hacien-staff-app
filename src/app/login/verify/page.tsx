import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BrandLogo } from "@/components/BrandLogo";
import { LoginVerifyForm } from "./LoginVerifyForm";

export const dynamic = "force-dynamic";

/** S-58: second sign-in step. Reached only after a password sign-in set the pending cookie. */
export default async function LoginVerifyPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="brand brand-full">
          <BrandLogo variant="full" />
        </div>
        <h1>Two-step sign-in</h1>
        <div className="subtitle">Enter the 6-digit code from your authenticator app.</div>
        <LoginVerifyForm />
        <div className="links">
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    </main>
  );
}
