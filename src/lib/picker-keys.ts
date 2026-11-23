// Shared keyboard-commit logic for the app's pickers (finding 1119).
//
// Every custom picker in the app — the shared SearchPicker (customer /
// contact / address / supplier), the quote editor's line-description
// catalog picker and its lot-component catalog picker — routes its
// navigation keys through this one function, so the keyboard contract is
// identical everywhere: ArrowDown / ArrowUp move the highlight (wrapping
// at both ends), Enter commits the highlighted option, Escape closes.
//
// The commit index is the VISIBLE highlight: an out-of-range active
// index is clamped before use, so Enter can never confirm a row the
// user does not see highlighted. A picker with no options yields no
// intent for the navigation/commit keys (the key keeps its default
// behaviour, e.g. a newline in a textarea), but Escape still closes —
// a failed or empty search panel must always be dismissible.

export type PickerKeyIntent =
  | { kind: "close" }
  | { kind: "highlight"; index: number }
  | { kind: "commit"; index: number };

export function pickerKeyIntent(key: string, optionCount: number, activeIndex: number): PickerKeyIntent | null {
  if (key === "Escape") return { kind: "close" };
  if (optionCount <= 0) return null;
  const active = Math.min(Math.max(activeIndex, 0), optionCount - 1);
  if (key === "ArrowDown") return { kind: "highlight", index: (active + 1) % optionCount };
  if (key === "ArrowUp") return { kind: "highlight", index: (active - 1 + optionCount) % optionCount };
  if (key === "Enter") return { kind: "commit", index: active };
  return null;
}
