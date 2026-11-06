// BIR 2303 auto-fill mapping (pure): turn Claude's structured fields
// into the form prefill + the filled / left-blank lists the uploader
// shows. Pure so the mapping is unit-testable without the component.
// Rules: only high/medium confidence fields fill, never a guess; a part
// that can't be parsed stays empty and the street keeps the usable text.
import type { Parsed2303Field, Structured2303 } from "./claude";

export type Prefill = {
  name?: string;
  tin?: string;
  street?: string;
  barangay?: string;
  cityMunicipality?: string;
  province?: string;
  zip?: string;
  notes?: string;
};

export type Filled = { label: string; value: string; confidence: "high" | "medium" };

function fillable(field: Parsed2303Field): string | null {
  return field.value && field.confidence !== "low" ? field.value : null;
}

function leftBlankReason(label: string, field: Parsed2303Field): string {
  if (!field.value) return `${label} — not on the certificate`;
  if (field.confidence === "low") return `${label} — low confidence, check the text and type it in`;
  return `${label} — not filled in`;
}

function addFilled(
  filled: Filled[],
  leftBlank: string[],
  prefill: Prefill,
  key: keyof Prefill,
  label: string,
  field: Parsed2303Field,
): void {
  const value = fillable(field);
  if (value) {
    filled.push({ label, value, confidence: field.confidence as "high" | "medium" });
    prefill[key] = value;
  } else {
    leftBlank.push(leftBlankReason(label, field));
  }
}

export function buildPrefill(fields: Structured2303): { prefill: Prefill; filled: Filled[]; leftBlank: string[] } {
  const filled: Filled[] = [];
  const leftBlank: string[] = [];
  const prefill: Prefill = {};

  addFilled(filled, leftBlank, prefill, "name", "Name", fields.registeredName);
  addFilled(filled, leftBlank, prefill, "tin", "TIN", fields.tin);

  // Street: the split street part when it fills, else the full address
  // string — the usable text is never lost when a part can't be parsed.
  const street = fillable(fields.addressStreet) ?? fillable(fields.registeredAddress);
  if (street) {
    const streetField = fillable(fields.addressStreet) ? fields.addressStreet : fields.registeredAddress;
    filled.push({ label: "Address", value: street, confidence: streetField.confidence as "high" | "medium" });
    prefill.street = street;
  } else {
    leftBlank.push(leftBlankReason("Address", fields.registeredAddress));
  }
  addFilled(filled, leftBlank, prefill, "barangay", "Barangay", fields.addressBarangay);
  addFilled(filled, leftBlank, prefill, "cityMunicipality", "City", fields.addressCity);
  addFilled(filled, leftBlank, prefill, "province", "Province", fields.addressProvince);
  addFilled(filled, leftBlank, prefill, "zip", "ZIP", fields.addressZip);

  const tradeName = fillable(fields.tradeName);
  const sameAsRegistered =
    !!tradeName && !!fields.registeredName.value && tradeName.trim().toLowerCase() === fields.registeredName.value.trim().toLowerCase();
  if (tradeName && !sameAsRegistered) {
    const notes = `Trade name: ${tradeName}`;
    filled.push({ label: "Notes", value: notes, confidence: fields.tradeName.confidence as "high" | "medium" });
    prefill.notes = notes;
  }
  return { prefill, filled, leftBlank };
}
