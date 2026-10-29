import { ForgotForm } from "./ForgotForm";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-logo">H</span>
          <span>HACIEN</span>
        </div>
        <h1>Forgot password</h1>
        <div className="subtitle">We&apos;ll email you a link to set a new password.</div>
        <ForgotForm />
      </div>
    </main>
  );
}
