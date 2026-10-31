import { BrandLogo } from "@/components/BrandLogo";
import { ForgotForm } from "./ForgotForm";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="brand brand-full">
          <BrandLogo variant="full" />
        </div>
        <h1>Forgot password</h1>
        <div className="subtitle">We&apos;ll email you a link to set a new password.</div>
        <ForgotForm />
      </div>
    </main>
  );
}
