import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/current-user";
import { newTotpSecret, totpSetupUri } from "@/lib/auth/totp";
import { PageHeader } from "@/components/ui";
import { TwoFactorSetupForm, TwoFactorDisableForm } from "./TwoFactorForms";

/** S-58: self-service two-step sign-in. Per user, optional — an Admin can reset it from Settings → Users. */
export default async function TwoStepPage() {
  const user = await requireUser();
  const record = await db.user.findUnique({ where: { id: user.id }, select: { totpSecret: true, email: true } });
  const enrolled = !!record?.totpSecret;
  const secret = enrolled ? null : newTotpSecret();
  const qrDataUrl = secret && record ? await QRCode.toDataURL(totpSetupUri(secret, record.email)) : null;

  return (
    <>
      <PageHeader title="Two-step sign-in" subtitle="After your password, sign-in asks for a 6-digit code from your authenticator app." />
      <div className="card">
        {enrolled ? (
          <>
            <p>Two-step sign-in is on for your account.</p>
            <p className="small faint">Lost your authenticator? Ask an Admin to reset two-step sign-in for you in Settings → Users.</p>
            <TwoFactorDisableForm />
          </>
        ) : (
          <>
            {secret && qrDataUrl ? <TwoFactorSetupForm secret={secret} qrDataUrl={qrDataUrl} /> : null}
            <p className="small faint">If you rotate the app&apos;s SESSION_SECRET, enrolled secrets stop working and staff re-enroll here.</p>
          </>
        )}
      </div>
    </>
  );
}
