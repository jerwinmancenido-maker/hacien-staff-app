export const BUSINESS_DOC_TYPES = [
  "DTI",
  "SEC",
  "CDA",
  "BIR_2303",
  "MAYORS_PERMIT",
  "PHILGEPS",
  "BARANGAY_CLEARANCE",
  "TAX_CLEARANCE",
  "OTHER",
] as const;
export type BusinessDocTypeValue = (typeof BUSINESS_DOC_TYPES)[number];

export const BUSINESS_DOC_LABELS: Record<BusinessDocTypeValue, string> = {
  DTI: "DTI registration",
  SEC: "SEC registration",
  CDA: "CDA registration",
  BIR_2303: "BIR 2303 (COR)",
  MAYORS_PERMIT: "Mayor's permit",
  PHILGEPS: "PhilGEPS",
  BARANGAY_CLEARANCE: "Barangay clearance",
  TAX_CLEARANCE: "Tax clearance",
  OTHER: "Other",
};

export function businessDocLabel(d: { type: BusinessDocTypeValue; otherLabel?: string | null }): string {
  return d.type === "OTHER" && d.otherLabel ? d.otherLabel : BUSINESS_DOC_LABELS[d.type];
}
