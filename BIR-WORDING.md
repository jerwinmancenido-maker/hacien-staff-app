# BIR-WORDING.md — HACIEN Staff-App Tax & Print Wording Policy (Non-CAS / Non-VAT Mode)

1. **Tax & System Status:** HACIEN Information Technology Solutions is a **BIR-registered Non-VAT** business. The internal staff web app is **NOT** a BIR-registered CAS/CBA. All official tax documents are issued separately from HACIEN's BIR-registered ATP booklets.
2. **Approved Constants (`src/lib/print/tax-wording.ts`):**
   - `BILLING_DISCLAIMER` (Surfaces 1–4 — Billing Summary, SOA Print, Billing View, On-Screen Billing/SOA):
     `For reference only — NOT a BIR-registered Sales Invoice or Collection/Official Receipt, and NOT valid for claiming input tax. Official BIR-registered Non-VAT Sales Invoices (and Collection Receipts, where applicable) are issued separately.`
   - `PACKING_LIST_DISCLAIMER` (Surface 5 — Packing List):
     `PACKING LIST / ATTACHMENT ONLY — NOT A BIR-REGISTERED SALES INVOICE, DELIVERY RECEIPT, OR COLLECTION/OFFICIAL RECEIPT. Not valid for claiming input tax; must accompany the official HACIEN Non-VAT Sales Invoice or BIR-registered Delivery Receipt.`
3. **Non-Negotiable Engineering & Wording Rules:**
   - **Never separate document titles into the disclaimer:** Keep `Statement of Account`, `Billing Summary`, or `Packing List` in the document header; reuse the single approved disclaimer constant in the footer/banner.
   - **Never print `"System-generated, no signature required."`** on any non-CAS billing, SOA, collection, or packing-list output.
   - **Never title an unregistered staff-app printout** as `Sales Invoice`, `Non-VAT Sales Invoice`, `Service Invoice`, `Billing Invoice`, `Official Receipt`, `Collection Receipt`, or `Delivery Receipt`.
   - **Never print prices, taxes, or payment-demand totals on a Packing List:** Limit Packing Lists to item description, SKU/model, serial numbers, quantities, package count, and the cross-referenced official HACIEN Sales Invoice / DR / PO number.
   - **Do not print standalone BIR ATP/CAS legends** (such as a bare `"THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX"` without the non-BIR reference disclaimer, or fake ATP/ACCN numbers).
   - **Change Control:** Any edit to `src/lib/print/tax-wording.ts` or transition to a BIR-registered CAS requires Jerwin's explicit written approval and updated legal/CPA verification.
