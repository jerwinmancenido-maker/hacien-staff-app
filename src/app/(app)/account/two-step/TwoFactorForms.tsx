"use client";

import { useActionState } from "react";
import Image from "next/image";
import { Field } from "@/components/Field";
import { setupTwoFactorAction, disableTwoFactorAction } from "../actions";

/** S-58: enrollment form — secret + code. The secret is the user's own; it is encrypted before storage. */
export function TwoFactorSetupForm({ secret, qrDataUrl }: { secret: string; qrDataUrl: string }) {
  const [state, action, pending] = useActionState(setupTwoFactorAction, {});
  return (
    <form action={action} noValidate>
      <p>Scan this QR code in your authenticator app (Google Authenticator, Microsoft Authenticator, or similar), then enter the 6-digit code it shows.</p>
      {/* QR code image from the qrcode package (data URL, no external host; unoptimized so no remote fetch). */}
      <Image src={qrDataUrl} alt="QR code for two-step setup" width={200} height={200} unoptimized />
      <p className="small faint">
        Can&apos;t scan? Enter this secret by hand: <code>{secret}</code>
      </p>
      <input type="hidden" name="secret" value={secret} />
      <Field label="Code from your authenticator app" name="code" error={state.fieldErrors?.code}>
        <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" />
      </Field>
      {state.message && (
        <p className="small" role="status">
          {state.message}
        </p>
      )}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Checking…" : "Turn on two-step sign-in"}
      </button>
    </form>
  );
}

/** S-58: turn two-step off, with a password check. */
export function TwoFactorDisableForm() {
  const [state, action, pending] = useActionState(disableTwoFactorAction, {});
  return (
    <form action={action} noValidate>
      <Field label="Your password" name="password" error={state.fieldErrors?.password}>
        <input id="password" name="password" type="password" autoComplete="current-password" />
      </Field>
      {state.message && (
        <p className="small" role="status">
          {state.message}
        </p>
      )}
      <button className="btn secondary" type="submit" disabled={pending}>
        Turn off two-step sign-in
      </button>
    </form>
  );
}
