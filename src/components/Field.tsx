import type { ReactNode } from "react";

export function Field({
  label,
  name,
  error,
  hint,
  required,
  full,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field${error ? " has-error" : ""}${full ? " full" : ""}`}>
      <label htmlFor={name}>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {error ? (
        <div className="error" id={`${name}-error`} role="alert">
          {error}
        </div>
      ) : (
        hint && <div className="hint">{hint}</div>
      )}
    </div>
  );
}
