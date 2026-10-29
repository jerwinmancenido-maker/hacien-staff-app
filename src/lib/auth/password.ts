import bcrypt from "bcryptjs";
import { z } from "zod";

const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  // Compare against a dummy hash when the user has none, so timing doesn't reveal it.
  return bcrypt.compare(plain, hash ?? DUMMY_HASH);
}

// bcrypt hash of a random string; never matches a real password.
const DUMMY_HASH = "$2b$12$Aic3L.BcDFT6GVa2jG1qYuN1pzOD4wvA9IpEnjjVb5YAEBis/3rIu";

export const newPasswordSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters.").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match." });
