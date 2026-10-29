import Link from "next/link";

export default function NoAccessPage() {
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <h1>No access</h1>
        <div className="subtitle">Your role can&apos;t open that page. Ask an Admin if you need it.</div>
        <Link className="btn" href="/">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
