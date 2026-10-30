// Reads the files of a multi-file input from a submitted form (server actions).

import { uploadMaxBytes } from "./business-docs/sniff";

/** Files from a multi-file input, size-checked before reading them into memory. */
export async function formFiles(form: FormData, name = "files"): Promise<{ files: { name: string; size: number; bytes: Uint8Array }[]; error?: string }> {
  const out: { name: string; size: number; bytes: Uint8Array }[] = [];
  for (const f of form.getAll(name)) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > uploadMaxBytes()) return { files: [], error: `${f.name}: the file is too big. The limit is ${Math.round(uploadMaxBytes() / 1024 / 1024)} MB.` };
    out.push({ name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  return { files: out };
}

