import { BrandLogo } from "@/components/BrandLogo";
import { verifyUnsubscribeToken } from "@/lib/marketing-consent";
import { unsubscribeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Public one-click unsubscribe (Q17, S-96). No login required; the signed
 * token proves the link belongs to this contact, so a random visitor cannot
 * unsubscribe someone else. Nothing changes until the button is clicked.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; done?: string; error?: string }>;
}) {
  const s = await searchParams;
  const token = s.token ?? "";
  const valid = token ? verifyUnsubscribeToken(token) !== null : false;
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="brand brand-full">
          <BrandLogo variant="full" />
        </div>
        <h1>Unsubscribe from HACIEN marketing emails</h1>
        {s.done ? (
          <div className="alert ok" role="status">
            Done. You will no longer receive marketing emails from HACIEN Team. Your email is kept on
            our do-not-email list so it is not added back by mistake.
          </div>
        ) : s.error ? (
          <div className="alert error" role="status">
            This unsubscribe link is invalid or has expired. Please contact HACIEN Team and ask to be
            removed from marketing emails.
          </div>
        ) : valid ? (
          <>
            <p className="subtitle">
              Click below to stop marketing emails from HACIEN Team. This takes effect immediately.
            </p>
            <form action={unsubscribeAction.bind(null, token)}>
              <button type="submit" className="btn">
                Unsubscribe from HACIEN marketing emails
              </button>
            </form>
          </>
        ) : (
          <div className="alert error" role="status">
            This unsubscribe link is invalid or has expired. Please contact HACIEN Team and ask to be
            removed from marketing emails.
          </div>
        )}
      </div>
    </main>
  );
}
