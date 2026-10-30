// File storage for uploads, on the server's disk OUTSIDE the web root.
//
// UPLOAD_DIR (e.g. /home/<user>/hacien-uploads/<env>) must live outside the app
// directory on Hostinger, because each deploy replaces the app directory.
// Development and tests default to ./.uploads (gitignored). Files are named by a
// random storage key only; the user's file name is never used on disk.

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export class StorageConfigError extends Error {}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Absolute upload directory. Refuses anything under public/ or .next/ (served or rebuilt by Next). */
export function uploadDir(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  const dir = path.resolve(cwd, env.UPLOAD_DIR?.trim() || ".uploads");
  for (const blocked of ["public", ".next"]) {
    if (inside(dir, path.resolve(cwd, blocked))) {
      throw new StorageConfigError(`UPLOAD_DIR can't be inside ${blocked}/ (files there are public or wiped on build).`);
    }
  }
  return dir;
}

/** Random, unguessable key ("c" + 32 hex chars, cuid-length). */
export function newStorageKey(): string {
  return `c${randomBytes(16).toString("hex")}`;
}

const KEY = /^c[0-9a-f]{32}$/;

export function isStorageKey(key: string): boolean {
  return KEY.test(key);
}

/** Path for a key. Only well-formed keys are accepted, so no input can point outside the directory. */
export function storagePath(key: string, dir: string = uploadDir()): string {
  if (!isStorageKey(key)) throw new StorageConfigError("Bad storage key.");
  const p = path.join(dir, key);
  if (path.dirname(p) !== dir) throw new StorageConfigError("Bad storage key.");
  return p;
}

export async function saveFile(key: string, bytes: Uint8Array, dir: string = uploadDir()): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // "wx": never overwrite an existing file.
  await writeFile(storagePath(key, dir), bytes, { flag: "wx", mode: 0o600 });
}

/** Remove a file that no database row points to (the upload's transaction failed). */
export async function discardUnreferencedFile(key: string, dir: string = uploadDir()): Promise<void> {
  await unlink(storagePath(key, dir)).catch(() => undefined);
}

export async function openFile(key: string, dir: string = uploadDir()) {
  const p = storagePath(key, dir);
  const info = await stat(p).catch(() => null);
  if (!info?.isFile()) return null;
  return { size: info.size, stream: createReadStream(p) };
}
