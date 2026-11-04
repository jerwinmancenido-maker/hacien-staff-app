// S-70: a user's optional uploaded signature image, shown on prints.
// Stored by storage key like the company logo (not a DocumentAttachment:
// a signature belongs to the user, not to one document). Only PNG, JPEG
// or WEBP, sniffed from magic bytes — never trusted from the file name.

import { db } from "../db";
import { writeAudit } from "../audit";
import { uploadMaxBytes } from "../business-docs/sniff";
import { discardUnreferencedFile, newStorageKey, saveFile } from "../business-docs/storage";
import { sniffLogoMime } from "../print/logo-sniff";

export class SignatureError extends Error {}

export async function saveUserSignature(
  userId: string,
  file: { name: string; size: number; bytes: Uint8Array },
  actorId: string,
): Promise<void> {
  if (file.size === 0) throw new SignatureError("Pick a signature image file.");
  if (file.size > uploadMaxBytes()) throw new SignatureError(`The file is too big. The limit is ${Math.round(uploadMaxBytes() / 1024 / 1024)} MB.`);
  const mime = sniffLogoMime(file.bytes.subarray(0, 16));
  if (!mime) throw new SignatureError("Use a PNG, JPG or WEBP signature image.");
  const key = newStorageKey();
  await saveFile(key, file.bytes);
  try {
    const before = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { signatureStorageKey: true } });
    const after = await db.user.update({
      where: { id: userId },
      data: { signatureStorageKey: key, signatureMimeType: mime, signatureFileName: file.name },
    });
    await writeAudit(db, { userId: actorId, entityType: "User", entityId: userId, action: "update", after: { signatureFileName: after.signatureFileName } });
    if (before.signatureStorageKey && before.signatureStorageKey !== key) await discardUnreferencedFile(before.signatureStorageKey);
  } catch (e) {
    await discardUnreferencedFile(key);
    throw e;
  }
}
