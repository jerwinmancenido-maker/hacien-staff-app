declare module "*/assert-local-db.mjs" {
  export const ALLOWED_LOCAL_DB_HOSTS: readonly string[];

  export function parseDatabaseUrlHost(databaseUrl: string | undefined | null): string | null;

  export function checkLocalSeedShots(
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): { ok: true; host: string } | { ok: false; error: string; host: string | null };

  export function assertLocalSeedShotsOrExit(
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
    io?: {
      exit?: (code: number) => void;
      error?: (...args: unknown[]) => void;
    },
  ): { ok: true; host: string } | { ok: false; error: string; host: string | null };
}

declare module "../scripts/lib/assert-local-db.mjs" {
  export const ALLOWED_LOCAL_DB_HOSTS: readonly string[];

  export function parseDatabaseUrlHost(databaseUrl: string | undefined | null): string | null;

  export function checkLocalSeedShots(
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): { ok: true; host: string } | { ok: false; error: string; host: string | null };

  export function assertLocalSeedShotsOrExit(
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
    io?: {
      exit?: (code: number) => void;
      error?: (...args: unknown[]) => void;
    },
  ): { ok: true; host: string } | { ok: false; error: string; host: string | null };
}
