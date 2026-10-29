// Contact rules (pure). One main contact per company while it has active contacts.
// Contacts are never deleted; inactive ones are hidden from pickers.

export type ContactLike = { id: string; isMain: boolean; active: boolean };

export const CANT_DEACTIVATE_MAIN = "This is the main contact. Make another contact main first.";

/** Whether a newly added contact must become main (first active contact always does). */
export function newContactIsMain(existing: readonly ContactLike[], requestedMain: boolean): boolean {
  const hasActiveMain = existing.some((c) => c.active && c.isMain);
  return requestedMain || !hasActiveMain;
}

/** Returns an error message if the contact can't be marked inactive. */
export function deactivateContactError(contact: ContactLike): string | null {
  if (contact.isMain && contact.active) return CANT_DEACTIVATE_MAIN;
  return null;
}

/** Returns an error message if the contact can't be made main. */
export function makeMainError(contact: ContactLike): string | null {
  if (!contact.active) return "Turn this contact back on before making it main.";
  return null;
}

/**
 * IDs whose isMain flag must change so `newMainId` is the only main.
 * The old main stays as a normal (active) contact.
 */
export function makeMainPlan(contacts: readonly ContactLike[], newMainId: string) {
  return {
    unset: contacts.filter((c) => c.isMain && c.id !== newMainId).map((c) => c.id),
    set: newMainId,
  };
}
