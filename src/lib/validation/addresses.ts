import { z } from "zod";

export const ADDRESS_KINDS = ["BILLING", "DELIVERY", "OFFICE", "WAREHOUSE", "OTHER"] as const;
export type AddressKindValue = (typeof ADDRESS_KINDS)[number];
export const ADDRESS_KIND_LABELS: Record<AddressKindValue, string> = {
  BILLING: "Billing",
  DELIVERY: "Delivery",
  OFFICE: "Office",
  WAREHOUSE: "Warehouse",
  OTHER: "Other",
};

/** Philippine ZIP codes are 4 digits. */
export const ZIP_PATTERN = /^\d{4}$/;

export function isValidZip(zip: string): boolean {
  return ZIP_PATTERN.test(zip.trim());
}

const required = (label: string, max: number) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `Keep this under ${max} characters.`);

export const addressSchema = z.object({
  kind: z.enum(ADDRESS_KINDS, { error: "Pick a type." }),
  label: z
    .string()
    .trim()
    .max(100, "Keep this under 100 characters.")
    .transform((v) => (v ? v : null)),
  street: required("Unit / building / street", 500),
  barangay: required("Barangay", 120),
  cityMunicipality: required("City / municipality", 120),
  province: required("Province", 120),
  zip: z.string().trim().regex(ZIP_PATTERN, "ZIP code is 4 digits."),
  isDefault: z.boolean(),
});
export type AddressInput = z.infer<typeof addressSchema>;
