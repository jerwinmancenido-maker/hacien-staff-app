import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// No hard deletes (see src/lib/no-delete.ts). The Prisma extension blocks them at
// runtime; this catches raw SQL DELETE/TRUNCATE and DELETE route handlers in review.
const RAW_DELETE = "/\\b(DELETE\\s+FROM|TRUNCATE)\\b/i";
const NO_DELETE_MESSAGE = "Hard deletes are not allowed. Archive or void the record instead (see src/lib/no-delete.ts).";

export const noHardDeleteRule = [
  "error",
  { selector: `TemplateElement[value.raw=${RAW_DELETE}]`, message: NO_DELETE_MESSAGE },
  { selector: `Literal[value=${RAW_DELETE}]`, message: NO_DELETE_MESSAGE },
  { selector: "ExportNamedDeclaration > FunctionDeclaration[id.name='DELETE']", message: NO_DELETE_MESSAGE },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}", "prisma/**/*.{ts,mts}"],
    rules: { "no-restricted-syntax": noHardDeleteRule },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);
