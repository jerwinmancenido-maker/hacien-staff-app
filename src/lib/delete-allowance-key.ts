/**
 * The key to the hard-delete allowance gate in src/lib/no-delete.ts.
 *
 * This symbol is the ONLY way to invoke the gate's run method. It is
 * imported by exactly two files: src/lib/no-delete.ts (which defines the
 * gate) and src/lib/services/document-delete.ts (the one sanctioned
 * delete path). tests/no-delete.test.ts source-scans for importers of
 * this module and fails if any other file imports it — do not import it
 * anywhere else.
 */
export const DELETE_ALLOWANCE_KEY: unique symbol = Symbol("hacien.deleteAllowance");
