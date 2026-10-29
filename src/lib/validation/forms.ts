import type { z } from "zod";

export type FieldErrors = Record<string, string>;

/** State returned by form server actions and read by useActionState. */
export type FormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  /** Echo of what the user typed, so the form keeps it after an error. */
  values?: Record<string, string>;
};

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

export function bool(form: FormData, key: string): boolean {
  const v = form.get(key);
  return v === "on" || v === "true" || v === "yes";
}

export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}

/** Trimmed string, empty → null. */
export function emptyToNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}
