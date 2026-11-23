import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

// Branded 404 (finding 1105). Before this file existed the app had no
// not-found.tsx anywhere, so every unmatched URL — and every notFound()
// call in the print and (app) pages — fell back to the bare
// framework-default page. This root boundary renders the app's own
// standalone branded surface (the login / no-access auth-card pattern):
// the official brand logo, a plain "Page not found" heading, and one
// pill recovery action. Copy is limited to the heading plus the app's
// existing "Back to Home" action label (the same label /no-access uses).
export default function NotFound() {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="brand brand-full">
          <BrandLogo variant="full" />
        </div>
        <h1>Page not found</h1>
        <Link className="btn" href="/">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
