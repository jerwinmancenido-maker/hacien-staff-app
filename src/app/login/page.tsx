import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BrandLogo } from "@/components/BrandLogo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { reset } = await searchParams;
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="brand brand-full">
          <BrandLogo variant="full" />
        </div>
        <h1>Sign in</h1>
        <div className="subtitle">Staff app for quotes, orders and billing.</div>
        {reset && <div className="alert ok">Password saved. Sign in with your new password.</div>}
        <LoginForm />
      </div>
    </main>
  );
}
